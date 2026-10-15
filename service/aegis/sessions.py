"""Sessions: an owner session is bound to exactly one tenant Safe; a bank session is read-only across the
tenants whose registry bank is its address (docs/MULTI-TENANT.md, Sessions and isolation)."""

from __future__ import annotations

import secrets
import time
from datetime import UTC, datetime

from eth_account import Account
from eth_account.messages import encode_defunct
from eth_utils import is_address, to_checksum_address

from aegis.services import Services
from aegis.workflow import Session, WorkflowError

SESSION_TTL = 12 * 3600
SIG_MAX_AGE = 600


def session_message(role: str, address: str, chain_id: int, issued_at: str) -> str:
    return f"AEGIS session\nrole: {role}\naddress: {address}\nchainId: {chain_id}\nissuedAt: {issued_at}"


def verify_signed_message(message: str, address: str, signature: str | None, issued_at: str | None,
                          max_age: int) -> None:
    """personal_sign check shared by sessions and onboarding."""
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
    try:
        signer = Account.recover_message(encode_defunct(text=message), signature=signature)
    except Exception:
        raise WorkflowError(401, "BadSignature") from None
    if signer.lower() != address.lower():
        raise WorkflowError(401, "BadSignature")


class SessionManager:
    def __init__(self, services: Services):
        self.s = services

    def create(self, role: str, address: str, signature: str | None = None, issued_at: str | None = None) -> dict:
        if role not in ("owner", "bank"):
            raise WorkflowError(400, "BadRole", "role must be owner or bank")
        if not isinstance(address, str) or not is_address(address):
            raise WorkflowError(400, "BadAddress")
        address = to_checksum_address(address)
        if self.s.settings.require_session_sig or signature:
            self._verify_signature(role, address, signature, issued_at)
        safe = None
        safes: list[str] = []
        if role == "owner":
            owned = [t["safe"] for t in self.s.tenants.by_owner(address)
                     if self.s.chain.policy(t["safe"], []).owner.lower() == address.lower()]
            if not owned:
                if self._registered_not_activated(address):
                    raise WorkflowError(403, "NotActivated", "finish onboarding: POST /api/onboard/activate")
                raise WorkflowError(403, "NotAnOwner", "address is not the registered owner of any AEGIS treasury")
            safe = owned[-1]
            safes = [safe]
        else:
            safes = self.bank_safes(address)
            if not safes:
                raise WorkflowError(403, "NotABank", "address is not the registered bank of any AEGIS treasury")
        token = secrets.token_urlsafe(32)
        now = time.time()
        self.s.db.execute("INSERT INTO sessions(token, role, address, safe, created_at, expires_at) VALUES "
                          "(?, ?, ?, ?, ?, ?)", (token, role, address, safe, now, now + SESSION_TTL))
        return {"token": token, "role": role, "address": address, "safe": safe, "safes": safes,
                "expiresAt": int(now + SESSION_TTL), "readOnly": role == "bank"}

    def _registered_not_activated(self, owner: str) -> bool:
        try:
            safe = self.s.chain.predict_safe(owner)
            return self.s.chain.policy(safe, []).owner.lower() == owner.lower()
        except Exception:
            return False

    def bank_safes(self, address: str) -> list[str]:
        """The registry bank is fixed at register() and copied into the tenant row at activation."""
        return [t["safe"] for t in self.s.tenants.by_bank(address)]

    def _verify_signature(self, role: str, address: str, signature: str | None, issued_at: str | None) -> None:
        verify_signed_message(session_message(role, address, self.s.settings.chain_id, issued_at or ""), address,
                              signature, issued_at, SIG_MAX_AGE)

    def get(self, token: str | None) -> Session | None:
        if not token:
            return None
        row = self.s.db.one("SELECT * FROM sessions WHERE token=?", (token,))
        if row is None or row["expires_at"] < time.time():
            return None
        return Session(row["token"], row["role"], row["address"], row["safe"])
