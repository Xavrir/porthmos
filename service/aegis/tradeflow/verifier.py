"""Proof Verifier (TECHNICAL-DOCUMENT 03, algorithm 7). "Now" is the latest block timestamp (C6).

Stage A (admission, C4) runs first: a failure is a 4xx with no ledger row and no state change, so an unsigned or
wrongly signed proof can never hold a milestone. Stage B runs in the contract's order and yields verified, waiting
(transient: C5, V1) or held.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from eth_utils import keccak

from aegis.chain.base import ChainClient
from aegis.config import Settings
from aegis.eip712 import hex32, recover_digest, to_bytes32
from aegis.tradeflow.checks import (
    WAITING_REASONS,
    condition_detail,
    conditions_hold,
    confirmation_failure,
    proof_time_ok,
)
from aegis.tradeflow.typed import (
    PENDING,
    MilestoneProof,
    MilestoneTerms,
    Order,
    ReleaseConfirmation,
    proof_digest,
    proof_struct_hash,
)
from aegis.workflow import WorkflowError


@dataclass
class Admitted:
    order: Order
    terms: MilestoneTerms
    proof: MilestoneProof
    signature: str
    proof_hash: str
    document_hash: str | None


@dataclass
class Verdict:
    outcome: str
    reason: str | None
    checks: list[dict]
    now: int
    waiting_on: dict = field(default_factory=dict)

    def to_json(self) -> dict:
        return {"outcome": self.outcome, "reason": self.reason, "checks": self.checks, "now": self.now}


def reject(status: int, code: str, detail: str = "") -> WorkflowError:
    return WorkflowError(status, code, detail, {"admitted": False})


class ProofVerifier:
    def __init__(self, chain: ChainClient, settings: Settings, authorizer_address):
        self.chain = chain
        self.settings = settings
        self._authorizer_address = authorizer_address

    @property
    def authorizer(self) -> str:
        return self._authorizer_address() if callable(self._authorizer_address) else self._authorizer_address

    def admit(self, order_id: int, index, proof_json, signature, document: bytes | None, served) -> Admitted:
        """Stage A. `served(buyer)` says whether the buyer Safe is a served tenant."""
        limit = self.settings.tradeflow.max_document_bytes
        if document is not None and len(document) > limit:
            raise reject(413, "DocumentTooLarge", f"documents are limited to {limit} bytes")
        if isinstance(index, bool) or not isinstance(index, int) or not 0 <= index <= 2:
            raise reject(422, "BadIndex", "index must be 0, 1 or 2")
        order = self.chain.escrow_order(order_id)
        if not order.exists or not served(order.buyer):
            raise reject(404, "UnknownOrder")
        if not order.active:
            raise reject(409, "OrderNotActive")
        terms, status = self.chain.escrow_milestones(order_id)[index]
        if status != PENDING:
            raise reject(409, "MilestoneAlreadyPaid")
        try:
            proof = MilestoneProof.from_json(proof_json)
        except (KeyError, TypeError, ValueError) as e:
            raise reject(422, "MalformedProof", str(e)) from None
        if (proof.orderId, proof.index, proof.kind) != (order_id, index, terms.kind):
            raise reject(422, "ProofMismatch", "proof orderId, index and kind must match the milestone")
        digest = proof_digest(self.chain.chain_id, self.settings.addresses.trade_escrow, proof)
        signer = recover_digest(digest, signature) if isinstance(signature, str) else None
        if signer is None or signer.lower() != terms.issuer.lower():
            raise reject(422, "BadIssuerSignature", "the signature does not recover to the milestone's issuer")
        doc_hash = None
        if document is not None:
            doc_hash = hex32(keccak(document))
            if to_bytes32(doc_hash) != to_bytes32(proof.docHash):
                raise reject(422, "DocumentHashMismatch", "keccak256(document) differs from docHash")
        return Admitted(order, terms, proof, signature, hex32(proof_struct_hash(proof)), doc_hash)

    def evaluate(self, order: Order, terms: MilestoneTerms, proof: MilestoneProof,
                 confirmation: tuple[ReleaseConfirmation, str] | None = None) -> Verdict:
        """Stage B, checks 5 to 10. Every check is recorded; the first failure in order decides."""
        pol = self.chain.policy(order.buyer, [])
        now = self.chain.block_timestamp()
        late = now > terms.deadline
        conf_failure = None
        if late:
            conf, sig = confirmation or (None, None)
            conf_failure = confirmation_failure(conf, sig, order.orderId, proof.index, proof_struct_hash(proof),
                                                pol.owner, now, self.chain.chain_id,
                                                self.settings.addresses.trade_escrow)
        checks = [
            ("OutOfOrder", proof.index == order.nextIndex,
             f"milestone {proof.index}; next unpaid milestone is {order.nextIndex}"),
            ("Frozen", not (pol.owner_frozen or pol.bank_frozen),
             f"ownerFrozen={pol.owner_frozen} bankFrozen={pol.bank_frozen}"),
            ("AuthorizerNotCurrent", pol.authorizer.lower() == self.authorizer.lower(),
             f"registry authorizer {pol.authorizer}"),
            ("BadProofTime", proof_time_ok(order, proof, now),
             f"createdAt {order.createdAt} <= issuedAt {proof.issuedAt} <= now {now}"),
            ("ConditionNotMet", conditions_hold(terms, proof), condition_detail(terms, proof)),
            ("DeadlinePassed", not late or conf_failure is None,
             f"deadline {terms.deadline}, now {now}" + (f", {conf_failure}" if late and conf_failure else
                                                         ", owner confirmed a late release" if late else "")),
        ]
        out = [{"name": n, "ok": ok, "detail": d} for n, ok, d in checks]
        failed = next((c["name"] for c in out if not c["ok"]), None)
        outcome = "verified" if failed is None else "waiting" if failed in WAITING_REASONS else "held"
        return Verdict(outcome, failed, out, now, {"policyVersion": pol.policy_version, "nextIndex": order.nextIndex})
