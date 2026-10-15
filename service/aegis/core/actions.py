"""Action Builder: the only source of typed actions (Approval envelopes and DARs)."""

from __future__ import annotations

import json

from eth_utils import keccak

from aegis.config import PRICE_ONE, Params
from aegis.core.state import TreasuryState
from aegis.eip712 import DAR, OP_DEPOSIT, ZERO32, Approval, approval_struct_hash, random_nonce


def price_band(price: int, max_band_width: int, params: Params) -> tuple[int, int] | None:
    """Band centred on the current price, no wider than maxBandWidth, clipped to the peg threshold so a
    deposit can never execute at a depegged price."""
    width = min(params.band_width, max_band_width)
    if width <= 0:
        return None
    low = max(price - width // 2, PRICE_ONE - params.peg_threshold)
    high = min(price + width // 2, PRICE_ONE + params.peg_threshold)
    if low > price or high < price or low > high:
        return None
    return low, high


def min_out(expected: int, params: Params) -> int:
    return expected * (10_000 - params.slippage_bps) // 10_000


def evidence_hash(evidence: dict) -> bytes:
    return keccak(text=json.dumps(evidence, sort_keys=True, separators=(",", ":"), default=str))


def build_approval(state: TreasuryState, op: int, vault: str, max_amount: int, now: int, params: Params) -> Approval:
    return Approval(
        safe=state.safe, op=op, vault=vault, maxAmount=max_amount, policyVersion=state.policy.policy_version,
        approvalExpiry=now + params.approval_expiry, approvalNonce=random_nonce(),
    )


def build_dar(state: TreasuryState, op: int, vault: str, amount: int, expected_out: int, tier: int,
              approval: Approval | None, evidence: bytes, now: int, params: Params) -> DAR:
    if op == OP_DEPOSIT:
        band = price_band(state.oracle.answer, state.policy.max_band_width, params)
        if band is None:
            raise ValueError("no valid price band at the current price")
        low, high = band
    else:
        low = high = state.oracle.answer
    return DAR(
        safe=state.safe, op=op, vault=vault, amount=amount, minOut=min_out(expected_out, params),
        policyVersion=state.policy.policy_version, priceLow=low, priceHigh=high, tier=tier,
        approvalHash=approval_struct_hash(approval) if approval is not None and tier >= 3 else ZERO32,
        nonce=random_nonce(), expiry=now + params.dar_expiry, evidenceHash=evidence,
    )
