"""Per-tenant refused attacks (docs/MULTI-TENANT.md, Per-tenant stress and attack actions).

The ATTACKER key broadcasts with a fixed gas limit, so the transaction is mined and its revert reason is on chain.
"""

from __future__ import annotations

import json
import secrets

from eth_account import Account

from aegis.config import USDC, load_key
from aegis.core.actions import price_band
from aegis.eip712 import DAR, OP_DEPOSIT, ZERO32, Approval, random_nonce
from aegis.errors import AuthorizerRefused
from aegis.procs.authorizer import INERT_MIN_AGE
from aegis.services import Services
from aegis.workflow import WorkflowError

ATTACK_GAS = 800_000
KINDS = ("tampered", "replay")
TAMPER_AMOUNT = 100 * USDC


class Attacks:
    def __init__(self, services: Services, authorizer):
        self.s = services
        self.authorizer = authorizer

    def run(self, safe: str, kind: str) -> dict:
        if kind not in KINDS:
            raise WorkflowError(400, "UnknownAttack", f"kind must be one of {KINDS}")
        limits = self.s.settings.limits
        try:
            key = load_key("attacker", self.s.settings.chain_id)
        except RuntimeError:
            raise WorkflowError(503, "AttackerUnavailable", "the attacker key is not configured") from None
        replay = self._replay(safe) if kind == "replay" else None
        if not self.s.limiter.hit("attack", safe.lower(), limits.attacks_per_tenant_hour, 3600):
            raise WorkflowError(429, "RateLimited", "attack actions are limited per treasury per hour")
        dar, sigs, approval = replay or self._tampered(safe)
        chain = self.s.chain
        try:
            if dar.op == OP_DEPOSIT:
                tx = chain.submit_deposit(key, dar, sigs["auth"], sigs.get("owner") or "", sigs.get("bank") or "",
                                          approval, gas=ATTACK_GAS)
            else:
                tx = chain.submit_redeem(key, dar, sigs["auth"], gas=ATTACK_GAS)
        except Exception as e:
            raise WorkflowError(503, "AttackSendFailed", f"{type(e).__name__}: {getattr(e, 'reason', e)}") from None
        rec = chain.wait_receipt(tx, timeout=60)
        reverted = rec is not None and rec.status == 0
        error = rec.revert_reason if reverted else None
        attacker = Account.from_key(key).address
        self.s.ledger.append("ATTACK_REFUSED" if reverted else "ATTACK_UNRESOLVED", safe,
                             {"kind": kind, "attacker": attacker, "op": dar.op, "vault": dar.vault,
                              "amount": str(dar.amount), "pending": rec is None,
                              "status": rec.status if rec else None},
                             tx_hash=tx, revert_reason=error)
        self.s.bus.publish({"type": "attack", "safe": safe, "kind": kind, "txHash": tx, "reverted": reverted,
                            "error": error})
        out = {"kind": kind, "txHash": tx, "reverted": reverted, "error": error}
        if rec is None:
            out["pending"] = True
        return out

    def _tampered(self, safe: str) -> tuple[DAR, dict, Approval]:
        """A small deposit DAR, signed by the Authorizer only in an already-expired (inert) form, then altered."""
        chain, settings = self.s.chain, self.s.settings
        vault = settings.addresses.vaults[0].address
        pol = chain.policy(safe, [vault])
        price = chain.latest_round().answer
        band = price_band(price, pol.max_band_width, settings.params) or (price, price)
        dar = DAR(safe=safe, op=OP_DEPOSIT, vault=vault, amount=TAMPER_AMOUNT,
                  minOut=chain.preview_deposit(vault, TAMPER_AMOUNT) * 995 // 1000,
                  policyVersion=pol.policy_version, priceLow=band[0], priceHigh=band[1],
                  tier=chain.module_required_tier(safe, vault, TAMPER_AMOUNT), approvalHash=ZERO32,
                  nonce=random_nonce(), expiry=chain.head_timestamp() - INERT_MIN_AGE - 60,
                  evidenceHash=bytes.fromhex(secrets.token_hex(32)))
        try:
            signed = self.authorizer.sign_inert({"dar": dar.to_json()})
        except AuthorizerRefused as e:
            raise WorkflowError(503, "AuthorizerRefused", str(e)) from None
        dar.amount = TAMPER_AMOUNT * 3
        return dar, {"auth": signed["signature"]}, Approval.empty()

    def _replay(self, safe: str) -> tuple[DAR, dict, Approval]:
        sub = self.s.db.one("SELECT * FROM submissions WHERE safe=? AND status='confirmed' "
                            "ORDER BY (op=0) DESC, id DESC LIMIT 1", (safe.lower(),))
        if sub is None:
            raise WorkflowError(409, "NothingToReplay", "this treasury has no executed DAR yet")
        approval = Approval.from_json(json.loads(sub["approval"])) if sub["approval"] else Approval.empty()
        return DAR.from_json(json.loads(sub["dar"])), json.loads(sub["sigs"]), approval
