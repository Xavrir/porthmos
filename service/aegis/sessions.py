"""Sessions: an owner session is bound to exactly one tenant Safe; a bank session is read-only across the
tenants whose registry bank is its address (docs/MULTI-TENANT.md, Sessions and isolation).

A session opens only with a Sign-In with Ethereum message (aegis.siwe) when REQUIRE_SESSION_SIG is on, which is the
default on every chain except a local Anvil.
"""

from __future__ import annotations

import secrets
import time
from datetime import UTC, datetime

from eth_utils import is_address, to_checksum_address

from aegis.services import Services
from aegis.sigverify import verify_personal
from aegis.siwe import SiweAuth
from aegis.workflow import Session, WorkflowError

SESSION_TTL = 12 * 3600
SIG_MAX_AGE = 600


def verify_signed_message(message: str, address: str, signature: str | None, issued_at: str | None,
                          max_age: int, chain=None) -> None:
    """personal_sign check for the fixed-format onboarding message (EOA, ERC-1271 or ERC-6492)."""
    if not signature or not issued_at:
        raise WorkflowError(401, "SignatureRequired",
                            "sign the message with personal_sign and send signature and issuedAt")
    try:
        ts = datetime.fromisoformat(issued_at.replace("Z", "+00:00"))
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=UTC)
    except ValueError:
        raise WorkflowError(400, "BadIssuedAt") from None
    if abs(time.time() - ts.timestamp()) > max_age:
        raise WorkflowError(401, "StaleSignature")
    if verify_personal(chain, address, message, signature) is None:
        raise WorkflowError(401, "BadSignature")


class SessionManager:
    def __init__(self, services: Services):
        self.s = services
        self.siwe = SiweAuth(services)

    def create(self, role: str | None, address: str | None, message: str | None = None,
               signature: str | None = None, legacy_issued_at: str | None = None) -> dict:
        if message is not None:
            v = self.siwe.verify(message, signature, purpose="session")
            if role is not None and role != v.role:
                raise WorkflowError(400, "WrongRole", "role does not match the signed message")
            if address is not None and (not isinstance(address, str) or address.lower() != v.address.lower()):
                raise WorkflowError(400, "BadAddress", "address does not match the signed message")
            return self.open(v.role, v.address, auth=v.method)
        if signature or legacy_issued_at:
            raise WorkflowError(400, "SiweRequired", "sign a SIWE (EIP-4361) message: GET /api/auth/nonce, then send "
                                                     "message and signature")
        if self.s.settings.require_session_sig:
            raise WorkflowError(401, "SignatureRequired", "sign a SIWE (EIP-4361) message: GET /api/auth/nonce, "
                                                          "then send message and signature")
        if role not in ("owner", "bank"):
            raise WorkflowError(400, "BadRole", "role must be owner or bank")
        if not isinstance(address, str) or not is_address(address):
            raise WorkflowError(400, "BadAddress")
        return self.open(role, to_checksum_address(address), auth="unsigned")

    def open(self, role: str, address: str, auth: str) -> dict:
        safe = None
        safes: list[str] = []
        if role == "owner":
            owned = self.owned_safes(address)
            if not owned:
                if self._registered_not_activated(address):
                    raise WorkflowError(403, "NotActivated", "finish onboarding: POST /api/onboard/activate")
                raise WorkflowError(403, "NotAnOwner", "address is not the registered owner of any AEGIS treasury")
            safe = owned[-1]
            safes = [safe]
        elif role == "bank":
            safes = self.bank_safes(address)
            if not safes:
                raise WorkflowError(403, "NotABank", "address is not the registered bank of any AEGIS treasury")
        else:
            raise WorkflowError(400, "BadRole", "role must be owner or bank")
        token = secrets.token_urlsafe(32)
        now = time.time()
        self.s.db.execute("INSERT INTO sessions(token, role, address, safe, created_at, expires_at) VALUES "
                          "(?, ?, ?, ?, ?, ?)", (token, role, address, safe, now, now + SESSION_TTL))
        return {"token": token, "role": role, "address": address, "safe": safe, "safes": safes,
                "expiresAt": int(now + SESSION_TTL), "readOnly": role == "bank", "auth": auth}

    def owned_safes(self, address: str) -> list[str]:
        return [t["safe"] for t in self.s.tenants.by_owner(address)
                if self.s.chain.policy(t["safe"], []).owner.lower() == address.lower()]

    def roles(self, address: str) -> dict:
        """What an address may sign in as, read from served tenants and the registry. All of it is public on-chain."""
        if not isinstance(address, str) or not is_address(address):
            raise WorkflowError(400, "BadAddress")
        address = to_checksum_address(address)
        owned = self.owned_safes(address)
        owner = None
        if owned:
            row = self.s.tenants.get(owned[-1])
            owner = {"safe": owned[-1], "bank": row["bank"] if row else None}
        pending = None
        if not owned and self._registered_not_activated(address):
            pending = {"safe": self.s.chain.predict_safe(address)}
        bank = [{"safe": t["safe"], "owner": t["owner"]} for t in self.s.tenants.by_bank(address)]
        return {"address": address, "owner": owner, "bank": bank, "pendingOwner": pending,
                "contract": self.s.chain.code_size(address) > 0}

    def _registered_not_activated(self, owner: str) -> bool:
        try:
            safe = self.s.chain.predict_safe(owner)
            return self.s.chain.policy(safe, []).owner.lower() == owner.lower()
        except Exception:
            return False

    def bank_safes(self, address: str) -> list[str]:
        """The registry bank is fixed at register() and copied into the tenant row at activation."""
        return [t["safe"] for t in self.s.tenants.by_bank(address)]

    def get(self, token: str | None) -> Session | None:
        if not token:
            return None
        row = self.s.db.one("SELECT * FROM sessions WHERE token=?", (token,))
        if row is None or row["expires_at"] < time.time():
            return None
        return Session(row["token"], row["role"], row["address"], row["safe"])
