"""personal_sign (EIP-191) verification for externally owned accounts and smart contract wallets.

Order: ecrecover first (an EOA costs no RPC call); an ERC-6492 wrapped signature from a wallet that is not deployed
yet goes to the deployless universal validator; any other signature for an address with code goes to its ERC-1271
isValidSignature. Coinbase Smart Wallet signs ERC-6492 before its first transaction and ERC-1271 after it.
"""

from __future__ import annotations

from eth_account import Account
from eth_account.messages import _hash_eip191_message, encode_defunct

from aegis.chain.base import ChainClient

ERC1271_MAGIC = bytes.fromhex("1626ba7e")
ERC6492_MAGIC = bytes.fromhex("64926492" * 8)


def personal_hash(message: str) -> bytes:
    return bytes(_hash_eip191_message(encode_defunct(text=message)))


def _bytes(signature: str) -> bytes | None:
    if not isinstance(signature, str) or not signature.startswith("0x"):
        return None
    try:
        return bytes.fromhex(signature[2:])
    except ValueError:
        return None


def recover_eoa(message: str, signature: str) -> str | None:
    try:
        return Account.recover_message(encode_defunct(text=message), signature=signature)
    except Exception:
        return None


def verify_personal(chain: ChainClient | None, address: str, message: str, signature: str | None) -> str | None:
    """Return how the signature verified ('eoa', 'erc1271' or 'erc6492'), or None when it does not."""
    raw = _bytes(signature or "")
    if raw is None or not raw:
        return None
    if len(raw) == 65:
        signer = recover_eoa(message, signature)
        if signer and signer.lower() == address.lower():
            return "eoa"
    if chain is None:
        return None
    digest = personal_hash(message)
    try:
        if raw.endswith(ERC6492_MAGIC):
            return "erc6492" if chain.erc6492_valid(address, digest, raw) else None
        if chain.code_size(address) > 0 and chain.erc1271_valid(address, digest, raw):
            return "erc1271"
    except Exception:
        return None
    return None
