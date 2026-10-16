"""Pure milestone checks with the contract's semantics (TECHNICAL-DOCUMENT 04, release checks 6 and 7)."""

from __future__ import annotations

from aegis.eip712 import ZERO32, recover_digest, to_bytes32
from aegis.tradeflow.typed import MilestoneProof, MilestoneTerms, Order, confirmation_digest

WAITING_REASONS = ("OutOfOrder", "Frozen", "AuthorizerNotCurrent")
HELD_REASONS = ("ConditionNotMet", "BadProofTime", "DeadlinePassed")
RETRYABLE = ("PolicyVersionMismatch", "Expired", "NonceUsed")


def conditions_hold(terms: MilestoneTerms, proof: MilestoneProof) -> bool:
    if terms.requireDoc and to_bytes32(proof.docHash) == ZERO32:
        return False
    if terms.checkTemp:
        if proof.samples == 0 or proof.minTempCenti > proof.maxTempCenti:
            return False
        if proof.minTempCenti < terms.minTempCenti or proof.maxTempCenti > terms.maxTempCenti:
            return False
    return True


def proof_time_ok(order: Order, proof: MilestoneProof, now: int) -> bool:
    return order.createdAt <= proof.issuedAt <= now


def condition_detail(terms: MilestoneTerms, proof: MilestoneProof) -> str:
    parts = []
    if terms.requireDoc:
        parts.append("document hash " + ("present" if to_bytes32(proof.docHash) != ZERO32 else "missing"))
    if terms.checkTemp:
        parts.append(f"readings {proof.minTempCenti / 100:.2f} to {proof.maxTempCenti / 100:.2f} C over "
                     f"{proof.samples} samples against {terms.minTempCenti / 100:.2f} to "
                     f"{terms.maxTempCenti / 100:.2f} C")
    return "; ".join(parts) or "no conditions"


def confirmation_failure(conf, signature: str | None, order_id: int, index: int, proof_hash: bytes, owner: str,
                         now: int, chain_id: int, escrow: str) -> str | None:
    """Why an owner ReleaseConfirmation does not cover this release, or None if it does (C8)."""
    if conf is None or not signature:
        return "ConfirmationRequired"
    signer = recover_digest(confirmation_digest(chain_id, escrow, conf), signature)
    if signer is None or signer.lower() != owner.lower():
        return "ConfirmationBadSigner"
    if (conf.orderId, conf.index, to_bytes32(conf.proofHash)) != (order_id, index, to_bytes32(proof_hash)):
        return "ConfirmationMismatch"
    if conf.expiry <= now:
        return "ConfirmationExpired"
    return None
