"""Safe v1.4.1 helpers for tenant onboarding (docs/MULTI-TENANT.md, steps 3 and 4).

The Safe address is a CREATE2 result of SafeProxyFactory.createProxyWithNonce, so the service can
recompute it from the owner alone and check that a tenant Safe is a genuine proxy of the expected singleton.
"""

from __future__ import annotations

from eth_utils import keccak, to_checksum_address

from aegis.chain.abi import Contract
from aegis.eip712 import ZERO_ADDRESS

SALT_TAG = b"aegis-v2"

SAFE = Contract("Safe")
FACTORY = Contract("SafeProxyFactory")


def _addr_bytes(address: str) -> bytes:
    return bytes.fromhex(to_checksum_address(address)[2:])


def salt_nonce(owner: str) -> int:
    """uint256(keccak256(abi.encodePacked(owner, "aegis-v2")))"""
    return int.from_bytes(keccak(_addr_bytes(owner) + SALT_TAG), "big")


def setup_data(owner: str, fallback_handler: str) -> bytes:
    return SAFE.encode("setup", [to_checksum_address(owner)], 1, ZERO_ADDRESS, b"",
                       to_checksum_address(fallback_handler), ZERO_ADDRESS, 0, ZERO_ADDRESS)


def create_proxy_data(singleton: str, owner: str, fallback_handler: str) -> bytes:
    return FACTORY.encode("createProxyWithNonce", to_checksum_address(singleton),
                          setup_data(owner, fallback_handler), salt_nonce(owner))


def predict_address(factory: str, singleton: str, owner: str, fallback_handler: str, proxy_code: bytes) -> str:
    salt = keccak(keccak(setup_data(owner, fallback_handler)) + salt_nonce(owner).to_bytes(32, "big"))
    init_code = proxy_code + int(singleton, 16).to_bytes(32, "big")
    return to_checksum_address(keccak(b"\xff" + _addr_bytes(factory) + salt + keccak(init_code))[12:])


def prevalidated_signature(owner: str) -> bytes:
    """r = owner, s = 0, v = 1: valid in execTransaction when msg.sender is that owner."""
    return int(owner, 16).to_bytes(32, "big") + b"\x00" * 32 + b"\x01"


def enable_module_exec_data(safe: str, module: str, owner: str) -> bytes:
    inner = SAFE.encode("enableModule", to_checksum_address(module))
    return SAFE.encode("execTransaction", to_checksum_address(safe), 0, inner, 0, 0, 0, 0, ZERO_ADDRESS,
                       ZERO_ADDRESS, prevalidated_signature(owner))


MULTISEND = Contract("MultiSendCallOnly")
ESCROW = Contract("TradeEscrow")
TOKEN = Contract("MockUSDC")


def multisend_payload(calls: list[tuple[str, bytes]]) -> bytes:
    """MultiSendCallOnly packing: operation (uint8, 0 = call), to, value, data length, data."""
    out = b""
    for to, data in calls:
        out += b"\x00" + _addr_bytes(to) + (0).to_bytes(32, "big") + len(data).to_bytes(32, "big") + data
    return out


def fund_order_exec_data(safe: str, owner: str, multisend: str, token: str, escrow: str, supplier: str, total: int,
                         terms_hash: bytes, terms: list) -> bytes:
    """The owner's one Safe transaction that funds an order (TECHNICAL-DOCUMENT 02, Funding path): a delegatecall to
    MultiSendCallOnly batching approve(escrow, total) and createOrder. The web encodes this itself (C1); this copy
    serves the integration tests and the evidence script, which act as the owner."""
    approve = TOKEN.encode("approve", to_checksum_address(escrow), total)
    create = ESCROW.encode("createOrder", to_checksum_address(supplier), total, terms_hash,
                           [t.as_tuple() for t in terms])
    batch = MULTISEND.encode("multiSend", multisend_payload([(token, approve), (escrow, create)]))
    return SAFE.encode("execTransaction", to_checksum_address(multisend), 0, batch, 1, 0, 0, 0, ZERO_ADDRESS,
                       ZERO_ADDRESS, prevalidated_signature(owner))


def owner_call_exec_data(target: str, data: bytes, owner: str) -> bytes:
    """A plain call from the Safe (for example TradeEscrow.waive or refund), signed by its threshold-1 owner."""
    return SAFE.encode("execTransaction", to_checksum_address(target), 0, data, 0, 0, 0, 0, ZERO_ADDRESS,
                       ZERO_ADDRESS, prevalidated_signature(owner))
