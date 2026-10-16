"""TradeEscrow structs and their EIP-712 encoding (TECHNICAL-DOCUMENT 04, TradeFlow structures).

Domain: name "TradeEscrow", version "1", the chain id and the TradeEscrow address. The field orders below are the
type strings; int32 values are sign-extended to 32 bytes by the ABI encoder, as EIP-712 specifies.
"""

from __future__ import annotations

from dataclasses import dataclass

from eth_abi import encode as abi_encode
from eth_account import Account
from eth_account.messages import encode_typed_data
from eth_utils import keccak, to_checksum_address

from aegis.eip712 import DOMAIN_FIELDS, _struct_hash, _type_string, hex32, to_bytes32

DOMAIN_NAME = "TradeEscrow"
DOMAIN_VERSION = "1"

KINDS = ("HANDOVER", "ARRIVAL", "QUALITY")
ORDER_STATUS = ("NONE", "ACTIVE", "COMPLETED", "REFUNDED")
MILESTONE_STATUS = ("PENDING", "RELEASED", "WAIVED", "REFUNDED")
ACTIVE = 1
PENDING = 0

PROOF_FIELDS = [
    ("orderId", "uint256"), ("index", "uint8"), ("kind", "uint8"), ("docHash", "bytes32"),
    ("minTempCenti", "int32"), ("maxTempCenti", "int32"), ("samples", "uint32"), ("issuedAt", "uint64"),
]
AUTH_FIELDS = [
    ("orderId", "uint256"), ("index", "uint8"), ("amount", "uint256"), ("proofHash", "bytes32"),
    ("policyVersion", "uint64"), ("nonce", "uint256"), ("expiry", "uint64"),
]
CONFIRMATION_FIELDS = [("orderId", "uint256"), ("index", "uint8"), ("proofHash", "bytes32"), ("expiry", "uint64")]

PROOF_TYPEHASH = keccak(text=_type_string("MilestoneProof", PROOF_FIELDS))
AUTH_TYPEHASH = keccak(text=_type_string("ReleaseAuthorization", AUTH_FIELDS))
CONFIRMATION_TYPEHASH = keccak(text=_type_string("ReleaseConfirmation", CONFIRMATION_FIELDS))
DOMAIN_TYPEHASH = keccak(text=_type_string("EIP712Domain", DOMAIN_FIELDS))

_BOUNDS = {"uint8": (0, 2**8 - 1), "uint32": (0, 2**32 - 1), "uint64": (0, 2**64 - 1), "uint256": (0, 2**256 - 1),
           "int32": (-(2**31), 2**31 - 1)}


def _int(data: dict, name: str, typ: str) -> int:
    value = data[name]
    if isinstance(value, bool) or not isinstance(value, (int, str)):
        raise ValueError(f"{name} must be an integer")
    value = int(value)
    lo, hi = _BOUNDS[typ]
    if not lo <= value <= hi:
        raise ValueError(f"{name} is outside {typ}")
    return value


def _bytes32(data: dict, name: str) -> bytes:
    value = data[name]
    if not isinstance(value, str) or len(value.removeprefix("0x")) != 64:
        raise ValueError(f"{name} must be 32 bytes of hex")
    return to_bytes32(value)


def _parse(cls, fields: list[tuple[str, str]], data: dict):
    if not isinstance(data, dict):
        raise ValueError(f"{cls.__name__} must be an object")
    values = {n: _bytes32(data, n) if t == "bytes32" else _int(data, n, t) for n, t in fields}
    return cls(**values)


def _to_json(obj, fields: list[tuple[str, str]]) -> dict:
    out = {}
    for n, t in fields:
        v = getattr(obj, n)
        if t == "bytes32":
            out[n] = hex32(to_bytes32(v))
        elif t in ("uint8", "int32", "uint32"):
            out[n] = int(v)
        else:
            out[n] = str(v)
    return out


@dataclass(frozen=True)
class MilestoneProof:
    orderId: int
    index: int
    kind: int
    docHash: bytes
    minTempCenti: int
    maxTempCenti: int
    samples: int
    issuedAt: int

    def as_tuple(self) -> tuple:
        return (self.orderId, self.index, self.kind, to_bytes32(self.docHash), self.minTempCenti, self.maxTempCenti,
                self.samples, self.issuedAt)

    def to_json(self) -> dict:
        return _to_json(self, PROOF_FIELDS)

    @classmethod
    def from_json(cls, data: dict) -> "MilestoneProof":
        return _parse(cls, PROOF_FIELDS, data)


@dataclass(frozen=True)
class ReleaseAuthorization:
    orderId: int
    index: int
    amount: int
    proofHash: bytes
    policyVersion: int
    nonce: int
    expiry: int

    def as_tuple(self) -> tuple:
        return (self.orderId, self.index, self.amount, to_bytes32(self.proofHash), self.policyVersion, self.nonce,
                self.expiry)

    def to_json(self) -> dict:
        return _to_json(self, AUTH_FIELDS)

    @classmethod
    def from_json(cls, data: dict) -> "ReleaseAuthorization":
        return _parse(cls, AUTH_FIELDS, data)


@dataclass(frozen=True)
class ReleaseConfirmation:
    """Signed by registry.owner(buyer); verified only by the Authorizer, never by the contract (C8)."""

    orderId: int
    index: int
    proofHash: bytes
    expiry: int

    def as_tuple(self) -> tuple:
        return (self.orderId, self.index, to_bytes32(self.proofHash), self.expiry)

    def to_json(self) -> dict:
        return _to_json(self, CONFIRMATION_FIELDS)

    @classmethod
    def from_json(cls, data: dict) -> "ReleaseConfirmation":
        return _parse(cls, CONFIRMATION_FIELDS, data)


@dataclass(frozen=True)
class MilestoneTerms:
    amount: int
    issuer: str
    kind: int
    requireDoc: bool
    checkTemp: bool
    minTempCenti: int
    maxTempCenti: int
    deadline: int

    @classmethod
    def from_tuple(cls, t) -> "MilestoneTerms":
        return cls(int(t[0]), to_checksum_address(t[1]), int(t[2]), bool(t[3]), bool(t[4]), int(t[5]), int(t[6]),
                   int(t[7]))

    def as_tuple(self) -> tuple:
        return (self.amount, to_checksum_address(self.issuer), self.kind, self.requireDoc, self.checkTemp,
                self.minTempCenti, self.maxTempCenti, self.deadline)

    def to_json(self) -> dict:
        return {"amount": str(self.amount), "issuer": to_checksum_address(self.issuer), "kind": self.kind,
                "kindName": KINDS[self.kind] if self.kind < len(KINDS) else str(self.kind),
                "requireDoc": self.requireDoc, "checkTemp": self.checkTemp, "minTempCenti": self.minTempCenti,
                "maxTempCenti": self.maxTempCenti, "deadline": self.deadline}


@dataclass(frozen=True)
class Order:
    orderId: int
    buyer: str
    supplier: str
    createdAt: int
    nextIndex: int
    status: int
    total: int
    released: int
    termsHash: bytes

    @classmethod
    def from_tuple(cls, order_id: int, t) -> "Order":
        return cls(order_id, to_checksum_address(t[0]), to_checksum_address(t[1]), int(t[2]), int(t[3]), int(t[4]),
                   int(t[5]), int(t[6]), to_bytes32(t[7]))

    @property
    def active(self) -> bool:
        return self.status == ACTIVE

    @property
    def exists(self) -> bool:
        return self.status != 0

    def to_json(self) -> dict:
        return {"orderId": str(self.orderId), "buyer": self.buyer, "supplier": self.supplier,
                "createdAt": self.createdAt, "nextIndex": self.nextIndex, "status": ORDER_STATUS[self.status],
                "total": str(self.total), "released": str(self.released), "termsHash": hex32(self.termsHash)}


def domain_separator(chain_id: int, escrow: str) -> bytes:
    return keccak(DOMAIN_TYPEHASH + abi_encode(
        ["bytes32", "bytes32", "uint256", "address"],
        [keccak(text=DOMAIN_NAME), keccak(text=DOMAIN_VERSION), chain_id, to_checksum_address(escrow)]))


def _digest(chain_id: int, escrow: str, struct_hash: bytes) -> bytes:
    return keccak(b"\x19\x01" + domain_separator(chain_id, escrow) + struct_hash)


def proof_struct_hash(p: MilestoneProof) -> bytes:
    return _struct_hash(PROOF_TYPEHASH, PROOF_FIELDS, p.as_tuple())


def auth_struct_hash(a: ReleaseAuthorization) -> bytes:
    return _struct_hash(AUTH_TYPEHASH, AUTH_FIELDS, a.as_tuple())


def confirmation_struct_hash(c: ReleaseConfirmation) -> bytes:
    return _struct_hash(CONFIRMATION_TYPEHASH, CONFIRMATION_FIELDS, c.as_tuple())


def proof_digest(chain_id: int, escrow: str, p: MilestoneProof) -> bytes:
    return _digest(chain_id, escrow, proof_struct_hash(p))


def auth_digest(chain_id: int, escrow: str, a: ReleaseAuthorization) -> bytes:
    return _digest(chain_id, escrow, auth_struct_hash(a))


def confirmation_digest(chain_id: int, escrow: str, c: ReleaseConfirmation) -> bytes:
    return _digest(chain_id, escrow, confirmation_struct_hash(c))


TYPED = {"MilestoneProof": PROOF_FIELDS, "ReleaseAuthorization": AUTH_FIELDS,
         "ReleaseConfirmation": CONFIRMATION_FIELDS}


def typed_data(primary: str, chain_id: int, escrow: str, message) -> dict:
    """Typed data for a wallet's eth_signTypedData_v4. Large integers are strings for JSON safety."""
    return {
        "types": {"EIP712Domain": [{"name": n, "type": t} for n, t in DOMAIN_FIELDS],
                  primary: [{"name": n, "type": t} for n, t in TYPED[primary]]},
        "primaryType": primary,
        "domain": {"name": DOMAIN_NAME, "version": DOMAIN_VERSION, "chainId": chain_id,
                   "verifyingContract": to_checksum_address(escrow)},
        "message": message.to_json(),
    }


def sign_typed(private_key: str, primary: str, chain_id: int, escrow: str, message) -> str:
    """Signs through eth_account's own EIP-712 encoder, the way a wallet would."""
    data = typed_data(primary, chain_id, escrow, message)
    msg = {}
    for n, t in TYPED[primary]:
        v = data["message"][n]
        msg[n] = bytes.fromhex(v[2:]) if t == "bytes32" else int(v)
    signed = Account.sign_message(encode_typed_data(full_message={**data, "message": msg}), private_key)
    return "0x" + bytes(signed.signature).hex()
