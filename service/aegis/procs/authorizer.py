"""Authorizer process: holds AUTHORIZER_KEY and signs a DAR only after re-verifying it independently.

It recomputes the reserve from the submitted schedule, the plan, the validator decision, the policy
tier and the simulation against its own chain reads. It never trusts the API's claimed results alone.
"""

from __future__ import annotations

import time

import httpx
from eth_account import Account
from fastapi import FastAPI, Header, HTTPException

from aegis.chain.base import ChainClient
from aegis.config import PRICE_ONE, Settings
from aegis.core import simulator
from aegis.core.actions import evidence_hash, min_out
from aegis.core.pipeline import prepare, snapshot
from aegis.core.reserve import Obligation
from aegis.db import Database
from aegis.eip712 import (
    DAR,
    OP_DEPOSIT,
    Approval,
    approval_digest,
    approval_struct_hash,
    dar_digest,
    hex32,
    recover_digest,
    sign_digest,
    to_bytes32,
)
from aegis.errors import AuthorizerRefused
from aegis.tenants import TenantStore

CLOCK_SKEW = 15
INERT_MIN_AGE = 3600


class Authorizer:
    def __init__(self, settings: Settings, chain: ChainClient, key: str, db: Database, tenants: TenantStore):
        self.settings = settings
        self.chain = chain
        self._key = key
        self.address = Account.from_key(key).address
        self.db = db
        self.tenants = tenants

    def sign_inert(self, payload: dict) -> dict:
        """Signs a deposit DAR whose expiry is at least an hour in the past, for the per-tenant tampering
        demonstration. Chain time only moves forward, so the signed DAR can never execute: submitted as signed it
        reverts Expired, and with any field changed the signer check fails first (BadSignature)."""
        try:
            dar = DAR.from_json(payload["dar"])
        except (KeyError, TypeError, ValueError) as e:
            raise AuthorizerRefused(f"MalformedRequest: {e}") from None
        if dar.safe.lower() not in {x.lower() for x in self.tenants.safes()}:
            raise AuthorizerRefused("UnknownSafe")
        if dar.op != OP_DEPOSIT:
            raise AuthorizerRefused("WrongOp")
        if dar.expiry + INERT_MIN_AGE > self.chain.head_timestamp():
            raise AuthorizerRefused("NotInert")
        digest = dar_digest(self.settings.chain_id, self.settings.addresses.module, dar)
        dar_hash = hex32(digest)
        self.db.execute("INSERT OR IGNORE INTO signed_dars(dar_hash, request_id, safe, nonce, signed_at, dar) VALUES "
                        "(?, ?, ?, ?, ?, ?)", (dar_hash, "inert", dar.safe.lower(), str(dar.nonce), time.time(),
                                               str(payload["dar"])))
        return {"signature": sign_digest(self._key, digest), "darHash": dar_hash, "signer": self.address}

    def sign(self, payload: dict) -> dict:
        try:
            return self._sign(payload)
        except AuthorizerRefused:
            raise
        except (KeyError, TypeError, ValueError) as e:
            raise AuthorizerRefused(f"MalformedRequest: {e}") from None

    def _sign(self, payload: dict) -> dict:
        s = self.settings
        dar = DAR.from_json(payload["dar"])
        approval = Approval.from_json(payload["approval"]) if payload.get("approval") else None
        sigs = payload.get("approvalSignatures") or {}
        known = {x.lower() for x in self.tenants.safes()}
        if dar.safe.lower() not in known or dar.safe.lower() != str(payload.get("safe", "")).lower():
            raise AuthorizerRefused("UnknownSafe")
        claimed = payload.get("serviceResults") or {}
        for stage in ("validation", "policy", "simulation"):
            if not (claimed.get(stage) or {}).get("ok"):
                raise AuthorizerRefused(f"ServiceReported{stage.capitalize()}Failure")

        now = self.chain.block_timestamp()
        if not (now < dar.expiry <= now + s.params.dar_expiry + CLOCK_SKEW):
            raise AuthorizerRefused("ExpiryOutOfRange")
        dar_hash = hex32(dar_digest(s.chain_id, s.addresses.module, dar))
        if self.chain.used_nonce(dar.safe, dar.nonce) or self.db.one(
                "SELECT 1 AS x FROM signed_dars WHERE safe=? AND nonce=?", (dar.safe.lower(), str(dar.nonce))):
            raise AuthorizerRefused("NonceUsed")

        obligations = [Obligation(o["id"], o["label"], int(o["amount"]["raw"]), int(o["due"]), o["kind"], True,
                                  bool(o.get("settled"))) for o in payload.get("obligations", [])]
        snap = snapshot(self.chain, s, dar.safe, obligations)
        if not snap.plan.in_sync:
            raise AuthorizerRefused("FloorOutOfSync")
        evidence = dict(payload.get("evidence") or {})
        ev_claimed = evidence.pop("evidenceHash", None)
        if evidence.get("scheduleHash") != snap.reserve.schedule_hash:
            raise AuthorizerRefused("ScheduleHashMismatch")
        if hex32(evidence_hash(evidence)) != hex32(to_bytes32(dar.evidenceHash)) or (
                ev_claimed and ev_claimed.lower() != hex32(to_bytes32(dar.evidenceHash)).lower()):
            raise AuthorizerRefused("EvidenceHashMismatch")

        sel = payload["selection"]
        mine = prepare(self.chain, s, snap, sel["optionId"], sel.get("reductions"), payload["requestId"],
                       self.address, approval=approval)
        if not mine.ok or mine.is_hold or mine.dar is None:
            raise AuthorizerRefused(f"Reverification{mine.stage.capitalize()}Failed: {mine.error}")
        ref = mine.dar
        if (ref.safe.lower(), ref.op, ref.vault.lower()) != (dar.safe.lower(), dar.op, dar.vault.lower()):
            raise AuthorizerRefused("ActionMismatch")
        if dar.amount > ref.amount:
            raise AuthorizerRefused("AmountAboveVerifiedOption")
        if dar.tier < ref.tier:
            raise AuthorizerRefused("TierBelowRequired")
        if dar.policyVersion != snap.state.policy.policy_version:
            raise AuthorizerRefused("PolicyVersionMismatch")

        out = simulator.expected_out(self.chain, dar.op, dar.vault, dar.amount, dar.safe)
        if not out.ok or dar.minOut < min_out(out.value, s.params) or dar.minOut == 0:
            raise AuthorizerRefused("MinOutTooLow")
        if dar.op == OP_DEPOSIT:
            price = snap.state.oracle.answer
            if not (dar.priceLow <= price <= dar.priceHigh):
                raise AuthorizerRefused("PriceOutOfBand")
            if dar.priceHigh - dar.priceLow > snap.state.policy.max_band_width:
                raise AuthorizerRefused("BandTooWide")
            if (dar.priceLow < PRICE_ONE - s.params.peg_threshold
                    or dar.priceHigh > PRICE_ONE + s.params.peg_threshold):
                raise AuthorizerRefused("BandOutsidePeg")

        if dar.tier >= 3:
            if approval is None:
                raise AuthorizerRefused("MissingApproval")
            if approval_struct_hash(approval) != to_bytes32(dar.approvalHash):
                raise AuthorizerRefused("ApprovalMismatch")
            if (approval.safe.lower(), approval.op, approval.vault.lower()) != (
                    dar.safe.lower(), dar.op, dar.vault.lower()):
                raise AuthorizerRefused("ApprovalMismatch")
            if dar.amount > approval.maxAmount:
                raise AuthorizerRefused("ApprovalExceeded")
            if now >= approval.approvalExpiry:
                raise AuthorizerRefused("ApprovalExpired")
            a_digest = approval_digest(s.chain_id, s.addresses.module, approval)
            pol = snap.state.policy
            if (recover_digest(a_digest, sigs.get("owner") or "") or "").lower() != pol.owner.lower():
                raise AuthorizerRefused("OwnerApprovalInvalid")
            if dar.tier >= 4 and (recover_digest(a_digest, sigs.get("bank") or "") or "").lower() != pol.bank.lower():
                raise AuthorizerRefused("BankApprovalInvalid")

        check = self.chain.module_check(dar, approval or Approval.empty())
        if not check.ok:
            raise AuthorizerRefused(f"SimulationFailed: {check.error}")
        if check.required_tier > dar.tier and dar.op == OP_DEPOSIT:
            raise AuthorizerRefused("TierBelowModuleRequirement")

        signature = sign_digest(self._key, dar_digest(s.chain_id, s.addresses.module, dar))
        self.db.execute("INSERT INTO signed_dars(dar_hash, request_id, safe, nonce, signed_at, dar) VALUES "
                        "(?, ?, ?, ?, ?, ?)", (dar_hash, payload.get("requestId"), dar.safe.lower(),
                                               str(dar.nonce), time.time(), str(payload["dar"])))
        return {"signature": signature, "darHash": dar_hash, "signer": self.address}


class HttpAuthorizerClient:
    """Used by the API process; the key lives only in the Authorizer process."""

    def __init__(self, url: str, token: str, fallback_address: str | None = None):
        self.url = url.rstrip("/")
        self.token = token
        self._address = fallback_address

    @property
    def address(self) -> str:
        if self._address is None:
            r = httpx.get(f"{self.url}/info", headers={"X-Aegis-Internal": self.token}, timeout=5)
            r.raise_for_status()
            self._address = r.json()["address"]
        return self._address

    def sign(self, payload: dict) -> dict:
        return self._post("/sign", payload)

    def sign_inert(self, payload: dict) -> dict:
        return self._post("/sign-inert", payload)

    def _post(self, path: str, payload: dict) -> dict:
        try:
            r = httpx.post(f"{self.url}{path}", json=payload, headers={"X-Aegis-Internal": self.token}, timeout=30)
        except httpx.HTTPError as e:
            raise AuthorizerRefused(f"AuthorizerUnavailable: {e}") from None
        if r.status_code == 409:
            raise AuthorizerRefused(r.json().get("detail", "refused"))
        if r.status_code != 200:
            raise AuthorizerRefused(f"AuthorizerError {r.status_code}")
        return r.json()


def create_app(authorizer: Authorizer, token: str) -> FastAPI:
    app = FastAPI(title="AEGIS Authorizer (internal)")

    def guard(x_aegis_internal: str | None):
        if not token or x_aegis_internal != token:
            raise HTTPException(401, "internal token required")

    @app.get("/info")
    def info(x_aegis_internal: str | None = Header(default=None)):
        guard(x_aegis_internal)
        return {"address": authorizer.address, "chainId": authorizer.settings.chain_id}

    @app.post("/sign")
    def sign(body: dict, x_aegis_internal: str | None = Header(default=None)):
        guard(x_aegis_internal)
        try:
            return authorizer.sign(body)
        except AuthorizerRefused as e:
            raise HTTPException(409, str(e)) from None

    @app.post("/sign-inert")
    def sign_inert(body: dict, x_aegis_internal: str | None = Header(default=None)):
        guard(x_aegis_internal)
        try:
            return authorizer.sign_inert(body)
        except AuthorizerRefused as e:
            raise HTTPException(409, str(e)) from None

    return app
