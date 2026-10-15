"""EIP-712 encoding for the AegisModule Approval and DAR structs (docs/INTERFACES.md 1.5)."""

from __future__ import annotations

import secrets
from dataclasses import asdict, dataclass, fields

from eth_abi import encode as abi_encode
from eth_account import Account
from eth_account.messages import encode_typed_data
from eth_utils import keccak, to_checksum_address

ZERO32 = b"\x00" * 32
ZERO_ADDRESS = "0x" + "0" * 40

OP_DEPOSIT = 0
OP_REDEEM = 1
OP_NAMES = {OP_DEPOSIT: "DEPOSIT", OP_REDEEM: "REDEEM"}

DOMAIN_NAME = "AegisModule"
DOMAIN_VERSION = "1"

APPROVAL_FIELDS = [
    ("safe", "address"), ("op", "uint8"), ("vault", "address"), ("maxAmount", "uint256"),
    ("policyVersion", "uint64"), ("approvalExpiry", "uint64"), ("approvalNonce", "uint256"),
]
DAR_FIELDS = [
    ("safe", "address"), ("op", "uint8"), ("vault", "address"), ("amount", "uint256"),
    ("minOut", "uint256"), ("policyVersion", "uint64"), ("priceLow", "int256"), ("priceHigh", "int256"),
    ("tier", "uint8"), ("approvalHash", "bytes32"), ("nonce", "uint256"), ("expiry", "uint64"),
    ("evidenceHash", "bytes32"),
]
DOMAIN_FIELDS = [
    ("name", "string"), ("version", "string"), ("chainId", "uint256"), ("verifyingContract", "address"),
]


def _type_string(name: str, flds: list[tuple[str, str]]) -> str:
    return f"{name}(" + ",".join(f"{t} {n}" for n, t in flds) + ")"


APPROVAL_TYPEHASH = keccak(text=_type_string("Approval", APPROVAL_FIELDS))
DAR_TYPEHASH = keccak(text=_type_string("DAR", DAR_FIELDS))
DOMAIN_TYPEHASH = keccak(text=_type_string("EIP712Domain", DOMAIN_FIELDS))


def random_nonce() -> int:
    return secrets.randbits(256)


def to_bytes32(value) -> bytes:
    if isinstance(value, bytes):
        return value.rjust(32, b"\x00")
    if isinstance(value, str):
        return bytes.fromhex(value.removeprefix("0x")).rjust(32, b"\x00")
    raise TypeError(f"cannot convert {value!r} to bytes32")


def hex32(value: bytes) -> str:
    return "0x" + bytes(value).hex()


@dataclass
class Approval:
    safe: str
    op: int
    vault: str
    maxAmount: int
    policyVersion: int
    approvalExpiry: int
    approvalNonce: int

    def as_tuple(self) -> tuple:
        return (
            to_checksum_address(self.safe), self.op, to_checksum_address(self.vault), self.maxAmount,
            self.policyVersion, self.approvalExpiry, self.approvalNonce,
        )

    def to_json(self) -> dict:
        d = asdict(self)
        for k in ("maxAmount", "policyVersion", "approvalExpiry", "approvalNonce"):
            d[k] = str(d[k])
        d["safe"] = to_checksum_address(self.safe)
        d["vault"] = to_checksum_address(self.vault)
        return d

    @classmethod
    def from_json(cls, data: dict) -> "Approval":
        return cls(
            safe=to_checksum_address(data["safe"]), op=int(data["op"]), vault=to_checksum_address(data["vault"]),
            maxAmount=int(data["maxAmount"]), policyVersion=int(data["policyVersion"]),
            approvalExpiry=int(data["approvalExpiry"]), approvalNonce=int(data["approvalNonce"]),
        )

    @classmethod
    def empty(cls) -> "Approval":
        return cls(ZERO_ADDRESS, 0, ZERO_ADDRESS, 0, 0, 0, 0)


@dataclass
class DAR:
    safe: str
    op: int
    vault: str
    amount: int
    minOut: int
    policyVersion: int
    priceLow: int
    priceHigh: int
    tier: int
    approvalHash: bytes
    nonce: int
    expiry: int
    evidenceHash: bytes

    def as_tuple(self) -> tuple:
        return (
            to_checksum_address(self.safe), self.op, to_checksum_address(self.vault), self.amount, self.minOut,
            self.policyVersion, self.priceLow, self.priceHigh, self.tier, to_bytes32(self.approvalHash),
            self.nonce, self.expiry, to_bytes32(self.evidenceHash),
        )

    def to_json(self) -> dict:
        d = {}
        for f in fields(self):
            v = getattr(self, f.name)
            if f.name in ("approvalHash", "evidenceHash"):
                d[f.name] = hex32(to_bytes32(v))
            elif f.name in ("safe", "vault"):
                d[f.name] = to_checksum_address(v)
            elif f.name in ("op", "tier"):
                d[f.name] = int(v)
            else:
                d[f.name] = str(v)
        return d

    @classmethod
    def from_json(cls, data: dict) -> "DAR":
        return cls(
            safe=to_checksum_address(data["safe"]), op=int(data["op"]), vault=to_checksum_address(data["vault"]),
            amount=int(data["amount"]), minOut=int(data["minOut"]), policyVersion=int(data["policyVersion"]),
            priceLow=int(data["priceLow"]), priceHigh=int(data["priceHigh"]), tier=int(data["tier"]),
            approvalHash=to_bytes32(data["approvalHash"]), nonce=int(data["nonce"]), expiry=int(data["expiry"]),
            evidenceHash=to_bytes32(data["evidenceHash"]),
        )


def _struct_hash(typehash: bytes, flds: list[tuple[str, str]], values: tuple) -> bytes:
    return keccak(typehash + abi_encode([t for _, t in flds], list(values)))


def approval_struct_hash(a: Approval) -> bytes:
    return _struct_hash(APPROVAL_TYPEHASH, APPROVAL_FIELDS, a.as_tuple())


def dar_struct_hash(d: DAR) -> bytes:
    return _struct_hash(DAR_TYPEHASH, DAR_FIELDS, d.as_tuple())


def domain_separator(chain_id: int, module: str) -> bytes:
    return keccak(
        DOMAIN_TYPEHASH
        + abi_encode(
            ["bytes32", "bytes32", "uint256", "address"],
            [keccak(text=DOMAIN_NAME), keccak(text=DOMAIN_VERSION), chain_id, to_checksum_address(module)],
        )
    )


def digest(chain_id: int, module: str, struct_hash: bytes) -> bytes:
    return keccak(b"\x19\x01" + domain_separator(chain_id, module) + struct_hash)


def dar_digest(chain_id: int, module: str, d: DAR) -> bytes:
    return digest(chain_id, module, dar_struct_hash(d))


def approval_digest(chain_id: int, module: str, a: Approval) -> bytes:
    return digest(chain_id, module, approval_struct_hash(a))


def sign_digest(private_key: str, msg_digest: bytes) -> str:
    signed = Account.unsafe_sign_hash(msg_digest, private_key)
    return "0x" + bytes(signed.signature).hex()


def recover_digest(msg_digest: bytes, signature: str) -> str | None:
    try:
        sig = bytes.fromhex(signature.removeprefix("0x"))
        if len(sig) != 65:
            return None
        return Account._recover_hash(msg_digest, signature=sig)
    except Exception:
        return None


def _domain_json(chain_id: int, module: str) -> dict:
    return {
        "name": DOMAIN_NAME, "version": DOMAIN_VERSION, "chainId": chain_id,
        "verifyingContract": to_checksum_address(module),
    }


def approval_typed_data(chain_id: int, module: str, a: Approval) -> dict:
    """Typed data for a wallet's eth_signTypedData_v4. Large integers are strings for JSON safety."""
    return {
        "types": {
            "EIP712Domain": [{"name": n, "type": t} for n, t in DOMAIN_FIELDS],
            "Approval": [{"name": n, "type": t} for n, t in APPROVAL_FIELDS],
        },
        "primaryType": "Approval",
        "domain": _domain_json(chain_id, module),
        "message": a.to_json(),
    }


def sign_approval_typed(private_key: str, chain_id: int, module: str, a: Approval) -> str:
    """Signs through eth_account's own EIP-712 encoder, the way a wallet would."""
    data = approval_typed_data(chain_id, module, a)
    msg = dict(data["message"])
    for k in ("maxAmount", "policyVersion", "approvalExpiry", "approvalNonce"):
        msg[k] = int(msg[k])
    full = {**data, "message": msg}
    signed = Account.sign_message(encode_typed_data(full_message=full), private_key)
    return "0x" + bytes(signed.signature).hex()
