"""Sign-In with Ethereum (EIP-4361) for sessions and treasury activation (docs/TECHNICAL-DOCUMENT.md 02, Sessions).

The browser asks GET /api/auth/nonce, builds the message, shows it, and the wallet signs it with personal_sign.
The server parses the message strictly (it must rebuild byte for byte), checks the domain allowlist, the URI, the
chain, the time window, the statement and the role resource, verifies the signature (EOA, ERC-1271 or ERC-6492) and
only then consumes the nonce, once.
"""

from __future__ import annotations

import fnmatch
import re
import secrets
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from urllib.parse import urlsplit

from eth_utils import is_checksum_address, to_checksum_address

from aegis.services import Services
from aegis.sigverify import verify_personal
from aegis.workflow import WorkflowError

VERSION = "1"
NONCE_TTL = 600
MAX_AGE = 600
MAX_VALIDITY = 3600
CLOCK_SKEW = 60
ROLES = ("owner", "bank")

_HEADER = re.compile(r"^(?:(?P<scheme>[a-zA-Z][a-zA-Z0-9+\-.]*)://)?(?P<domain>[^\s/]+) wants you to sign in with your "
                     r"Ethereum account:$")
_ADDRESS = re.compile(r"^0x[0-9a-fA-F]{40}$")
_NONCE = re.compile(r"^[a-zA-Z0-9]{8,}$")
_DATETIME = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$")
_FIELDS = ("URI", "Version", "Chain ID", "Nonce", "Issued At")
_OPTIONAL = ("Expiration Time", "Not Before", "Request ID")


def role_resource(role: str) -> str:
    return f"urn:porthmos:role:{role}"


def safe_resource(safe: str) -> str:
    return f"urn:porthmos:safe:{to_checksum_address(safe)}"


def session_statement(role: str) -> str:
    return f"Sign in to Porthmos as {role}."


ACTIVATION_STATEMENT = "Activate my Porthmos treasury and sign in as owner."


@dataclass(frozen=True)
class SiweMessage:
    domain: str
    address: str
    statement: str | None
    uri: str
    version: str
    chain_id: int
    nonce: str
    issued_at: str
    expiration_time: str | None = None
    not_before: str | None = None
    request_id: str | None = None
    resources: tuple[str, ...] = ()
    scheme: str | None = None


def build(m: SiweMessage) -> str:
    """The exact EIP-4361 layout viem's createSiweMessage writes, so both sides agree on every byte."""
    origin = f"{m.scheme}://{m.domain}" if m.scheme else m.domain
    lines = [f"{origin} wants you to sign in with your Ethereum account:", m.address, ""]
    if m.statement:
        lines += [m.statement, ""]
    else:
        lines += [""]
    lines += [f"URI: {m.uri}", f"Version: {m.version}", f"Chain ID: {m.chain_id}", f"Nonce: {m.nonce}",
              f"Issued At: {m.issued_at}"]
    if m.expiration_time:
        lines.append(f"Expiration Time: {m.expiration_time}")
    if m.not_before:
        lines.append(f"Not Before: {m.not_before}")
    if m.request_id is not None:
        lines.append(f"Request ID: {m.request_id}")
    if m.resources:
        lines.append("Resources:")
        lines += [f"- {r}" for r in m.resources]
    return "\n".join(lines)


def _bad(detail: str) -> WorkflowError:
    return WorkflowError(400, "SiweMalformed", detail)


def parse(text: str) -> SiweMessage:
    if not isinstance(text, str) or len(text) > 4096 or "\r" in text:
        raise _bad("the message is not an EIP-4361 text")
    lines = text.split("\n")
    head = _HEADER.match(lines[0]) if lines else None
    if not head or len(lines) < 9:
        raise _bad("the first line is not an EIP-4361 header")
    address = lines[1]
    if not _ADDRESS.match(address) or not is_checksum_address(address):
        raise _bad("the address must be an EIP-55 checksum address")
    if lines[2] != "":
        raise _bad("a blank line must follow the address")
    i = 3
    statement = None
    if lines[i] == "":
        i += 1
    else:
        statement = lines[i]
        if lines[i + 1] != "":
            raise _bad("a blank line must follow the statement")
        i += 2
    values: dict[str, str] = {}
    for name in _FIELDS:
        if i >= len(lines) or not lines[i].startswith(f"{name}: "):
            raise _bad(f"missing {name}")
        values[name] = lines[i][len(name) + 2:]
        i += 1
    for name in _OPTIONAL:
        if i < len(lines) and lines[i].startswith(f"{name}: "):
            values[name] = lines[i][len(name) + 2:]
            i += 1
    resources: list[str] = []
    if i < len(lines) and lines[i] == "Resources:":
        i += 1
        while i < len(lines) and lines[i].startswith("- "):
            resources.append(lines[i][2:])
            i += 1
    if i != len(lines):
        raise _bad("unexpected text after the message fields")
    if values["Version"] != VERSION:
        raise _bad("only SIWE version 1 is accepted")
    if not values["Chain ID"].isdigit():
        raise _bad("Chain ID is not a number")
    if not _NONCE.match(values["Nonce"]):
        raise _bad("the nonce must be at least 8 letters or digits")
    for name in ("Issued At", "Expiration Time", "Not Before"):
        if name in values and _time(values[name]) is None:
            raise _bad(f"{name} is not an RFC 3339 date-time")
    m = SiweMessage(
        domain=head["domain"], address=address, statement=statement, uri=values["URI"], version=values["Version"],
        chain_id=int(values["Chain ID"]), nonce=values["Nonce"], issued_at=values["Issued At"],
        expiration_time=values.get("Expiration Time"), not_before=values.get("Not Before"),
        request_id=values.get("Request ID"), resources=tuple(resources), scheme=head["scheme"],
    )
    if build(m) != text:
        raise _bad("the message is not in canonical EIP-4361 form")
    return m


def _time(value: str) -> float | None:
    if not _DATETIME.match(value):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(UTC).timestamp()
    except ValueError:
        return None


def domain_allowed(domain: str, allowlist: list[str]) -> bool:
    d = domain.lower()
    for entry in allowlist:
        e = entry.strip().lower()
        if not e:
            continue
        if e.endswith(":*"):
            host = e[:-2]
            if d == host or (d.startswith(host + ":") and d[len(host) + 1:].isdigit()):
                return True
        elif "*" not in e and d == e:
            return True
        elif "*" in e and not e.endswith(":*") and fnmatch.fnmatchcase(d, e):
            return True
    return False


def _uri_ok(uri: str, domain: str) -> bool:
    try:
        u = urlsplit(uri)
    except ValueError:
        return False
    host = (u.hostname or "").lower()
    local = host in ("localhost", "127.0.0.1", "::1")
    if u.scheme != "https" and not (u.scheme == "http" and local):
        return False
    return u.netloc.lower() == domain.lower()


@dataclass(frozen=True)
class Verified:
    message: SiweMessage
    address: str
    role: str
    method: str


class SiweAuth:
    def __init__(self, services: Services):
        self.s = services

    def issue_nonce(self, ip_hash: str) -> dict:
        if not self.s.limiter.hit("auth_nonce_ip", ip_hash, self.s.settings.limits.auth_per_ip_minute, 60):
            raise WorkflowError(429, "RateLimited", "too many sign-in requests from this address; wait a minute")
        now = time.time()
        nonce = secrets.token_hex(16)
        self.s.db.execute("DELETE FROM auth_nonces WHERE expires_at < ?", (now - 3600,))
        self.s.db.execute("INSERT INTO auth_nonces(nonce, created_at, expires_at) VALUES (?, ?, ?)",
                          (nonce, now, now + NONCE_TTL))
        return {"nonce": nonce, "issuedAt": _iso(now), "expiresAt": _iso(now + NONCE_TTL),
                "chainId": self.s.settings.chain_id, "statement": {r: session_statement(r) for r in ROLES}}

    def verify(self, text: str, signature: str | None, *, purpose: str, safe: str | None = None) -> Verified:
        """purpose 'session' (any role) or 'activate' (owner of `safe`)."""
        if not signature:
            raise WorkflowError(401, "SignatureRequired", "sign the SIWE message and send message and signature")
        m = parse(text)
        st = self.s.settings
        if m.scheme is not None:
            raise WorkflowError(401, "WrongDomain", "the message must not carry a scheme before the domain")
        if not domain_allowed(m.domain, st.siwe_domains):
            raise WorkflowError(401, "WrongDomain", f"{m.domain} is not a Porthmos domain")
        if not _uri_ok(m.uri, m.domain):
            raise WorkflowError(401, "WrongUri", "the URI must be the https origin of the domain")
        if m.chain_id != st.chain_id:
            raise WorkflowError(401, "WrongChain", f"this service signs in on chain {st.chain_id}")
        now = time.time()
        issued = _time(m.issued_at)
        if issued is None or issued > now + CLOCK_SKEW:
            raise WorkflowError(401, "BadIssuedAt", "Issued At is in the future")
        if now - issued > MAX_AGE:
            raise WorkflowError(401, "StaleSignature", "the message is too old; sign a fresh one")
        if not m.expiration_time:
            raise WorkflowError(401, "SiweMalformed", "the message needs an Expiration Time")
        expires = _time(m.expiration_time)
        if expires is None or expires <= now:
            raise WorkflowError(401, "MessageExpired", "the message has expired; sign a fresh one")
        if expires - issued > MAX_VALIDITY:
            raise WorkflowError(401, "SiweMalformed", "the message may be valid for one hour at most")
        if m.not_before and (_time(m.not_before) or 0) > now + CLOCK_SKEW:
            raise WorkflowError(401, "NotYetValid", "the message is not valid yet")
        role = self._role(m, purpose, safe)
        row = self.s.db.one("SELECT created_at, expires_at, used_at FROM auth_nonces WHERE nonce=?", (m.nonce,))
        if row is None:
            raise WorkflowError(401, "BadNonce", "this nonce was not issued here; ask GET /api/auth/nonce")
        if row["used_at"] is not None:
            raise WorkflowError(401, "NonceUsed", "this message was already used; sign a fresh one")
        if row["expires_at"] <= now:
            raise WorkflowError(401, "NonceExpired", "the sign-in request expired; sign a fresh one")
        if issued < row["created_at"] - CLOCK_SKEW:
            raise WorkflowError(401, "BadIssuedAt", "Issued At is before the nonce was issued")
        method = verify_personal(self.s.chain, m.address, text, signature)
        if method is None:
            raise WorkflowError(401, "BadSignature", "the signature does not match the address in the message")
        claimed = self.s.db.execute("UPDATE auth_nonces SET used_at=? WHERE nonce=? AND used_at IS NULL AND "
                                    "expires_at > ?", (now, m.nonce, now)).rowcount
        if claimed != 1:
            raise WorkflowError(401, "NonceUsed", "this message was already used; sign a fresh one")
        return Verified(m, to_checksum_address(m.address), role, method)

    def _role(self, m: SiweMessage, purpose: str, safe: str | None) -> str:
        role_urns = [r for r in m.resources if r.startswith("urn:porthmos:role:")]
        if purpose == "activate":
            if m.statement != ACTIVATION_STATEMENT:
                raise WorkflowError(401, "WrongStatement", f"the statement must be: {ACTIVATION_STATEMENT}")
            if not safe or set(m.resources) != {role_resource("owner"), safe_resource(safe)} or len(m.resources) != 2:
                raise WorkflowError(401, "WrongRole", "the resources must name the owner role and this Safe")
            return "owner"
        role = next((r for r in ROLES if m.statement == session_statement(r)), None)
        if role is None:
            raise WorkflowError(401, "WrongStatement", "the statement must be: Sign in to Porthmos as owner. "
                                                       "(or bank.)")
        if role_urns != [role_resource(role)] or len(m.resources) != 1:
            raise WorkflowError(401, "WrongRole", f"the resources must be exactly {role_resource(role)}")
        return role


def _iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def client_message(*, address: str, chain_id: int, nonce: str, role: str = "owner", activate_safe: str | None = None,
                   domain: str = "localhost", uri: str | None = None, now: float | None = None,
                   ttl: int = NONCE_TTL) -> str:
    """The message a client builds: a session sign-in, or with activate_safe the activation message."""
    t = time.time() if now is None else now
    statement = ACTIVATION_STATEMENT if activate_safe else session_statement(role)
    resources = (role_resource("owner"), safe_resource(activate_safe)) if activate_safe else (role_resource(role),)
    return build(SiweMessage(domain=domain, address=to_checksum_address(address), statement=statement,
                             uri=uri or f"{'http' if domain.split(':')[0] in ('localhost', '127.0.0.1') else 'https'}"
                                        f"://{domain}",
                             version=VERSION, chain_id=chain_id, nonce=nonce, issued_at=_iso(t),
                             expiration_time=_iso(t + ttl), resources=resources))
