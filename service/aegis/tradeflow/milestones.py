"""TradeFlow milestone workflow (TECHNICAL-DOCUMENT 03, milestone state machine; 02, TradeFlow off-chain flow).

Each milestone of a served order has one persisted off-chain state. The API process is the only writer of the
tf_* tables; the Executor reports through the shared submissions table. These rules are workflow policy, not a
security boundary: the Authorizer re-verifies and TradeEscrow enforces the binding rules on its own.
"""

from __future__ import annotations

import json
import re
import threading
import time
import uuid

from aegis.agent.agent import Agent
from aegis.core.reserve import required_reserve
from aegis.eip712 import hex32, random_nonce, recover_digest, to_bytes32
from aegis.errors import AuthorizerRefused
from aegis.obligations import to_json as obligation_json
from aegis.services import Services
from aegis.tradeflow import explain as vagent
from aegis.tradeflow.checks import HELD_REASONS, RETRYABLE, WAITING_REASONS
from aegis.tradeflow.issuers import DemoIssuers
from aegis.tradeflow.typed import (
    MILESTONE_STATUS,
    PENDING,
    MilestoneProof,
    MilestoneTerms,
    Order,
    ReleaseAuthorization,
    ReleaseConfirmation,
    auth_digest,
    confirmation_digest,
)
from aegis.tradeflow.verifier import ProofVerifier, Verdict, reject
from aegis.units import amount
from aegis.workflow import Session, WorkflowError

STATES = ("AWAITING_PROOF PROOF_RECEIVED PROOF_VERIFIED RELEASE_SIGNED RELEASE_SUBMITTED RELEASED RELEASE_FAILED "
          "WAITING HELD WAIVED REFUNDED").split()
TERMINAL = {"RELEASED", "WAIVED", "REFUNDED"}
IN_FLIGHT = {"PROOF_RECEIVED", "PROOF_VERIFIED", "RELEASE_SIGNED", "RELEASE_SUBMITTED", "RELEASE_FAILED"}
TRANSITIONS: dict[str, set[str]] = {
    "AWAITING_PROOF": {"PROOF_RECEIVED"},
    "PROOF_RECEIVED": {"PROOF_VERIFIED", "WAITING", "HELD"},
    "PROOF_VERIFIED": {"RELEASE_SIGNED", "WAITING", "HELD"},
    "RELEASE_SIGNED": {"RELEASE_SUBMITTED", "RELEASE_FAILED"},
    "RELEASE_SUBMITTED": {"RELEASED", "RELEASE_FAILED"},
    "RELEASE_FAILED": {"PROOF_RECEIVED", "WAITING", "HELD"},
    "WAITING": {"PROOF_RECEIVED"},
    "HELD": {"PROOF_RECEIVED"},
}
LEDGER_KIND = {"PROOF_RECEIVED": "PROOF_RECEIVED", "WAITING": "MILESTONE_WAITING", "HELD": "MILESTONE_HELD",
               "RELEASE_SIGNED": "RELEASE_SIGNED", "RELEASE_FAILED": "RELEASE_FAILED",
               "RELEASED": "MILESTONE_RELEASED", "WAIVED": "MILESTONE_WAIVED"}
SETTLEMENT_KINDS = ("MILESTONE_RELEASED", "MILESTONE_WAIVED", "ORDER_REFUNDED")
OP_RELEASE = 2
SCAN_KEY = "tradeflow_scan_block"
STUCK_AFTER = 15.0


def refusal_code(e: Exception) -> str:
    return re.split(r"[:\s]", str(e).strip(), maxsplit=1)[0] or "Refused"


class TradeFlow:
    def __init__(self, services: Services, agent: Agent, authorizer):
        self.s = services
        self.settings = services.settings
        self.agent = agent
        self.authorizer = authorizer
        self.verifier = ProofVerifier(services.chain, services.settings, lambda: self.authorizer.address)
        self.issuers = DemoIssuers(services.settings)
        self._locks: dict[int, threading.RLock] = {}
        self._guard = threading.Lock()

    @property
    def chain(self):
        return self.s.chain

    def _lock(self, order_id: int) -> threading.RLock:
        with self._guard:
            return self._locks.setdefault(int(order_id), threading.RLock())

    def served(self, buyer: str) -> bool:
        return self.s.known_safe(buyer) is not None

    def order_row(self, order_id: int) -> dict | None:
        return self.s.db.one("SELECT * FROM tf_orders WHERE order_id=?", (int(order_id),))

    def milestone(self, order_id: int, index: int) -> dict:
        row = self.s.db.one("SELECT * FROM tf_milestones WHERE order_id=? AND idx=?", (int(order_id), index))
        row["data"] = json.loads(row["data"])
        return row

    def _save(self, m: dict) -> None:
        m["updated_at"] = time.time()
        self.s.db.execute("UPDATE tf_milestones SET state=?, reason=?, request_id=?, data=?, updated_at=? WHERE "
                          "order_id=? AND idx=?", (m["state"], m["reason"], m["request_id"],
                                                   json.dumps(m["data"], default=str), m["updated_at"],
                                                   m["order_id"], m["idx"]))

    def _move(self, m: dict, to: str, note: str = "", ledger: dict | None = None, reason: str | None = None,
              external: bool = False, **ledger_kw) -> dict | None:
        """One transition: state row, transition row, and the ledger row of that state's kind when one is given.

        `external` admits a chain-observed settlement (released, waived or refunded by anyone) from any open state.
        """
        frm = m["state"]
        if to not in STATES:
            raise ValueError(f"unknown milestone state {to}")
        if not (external and to in TERMINAL and frm not in TERMINAL) and to not in TRANSITIONS.get(frm, set()):
            raise WorkflowError(409, "IllegalTransition", f"{frm} -> {to}")
        m["state"] = to
        m["reason"] = reason
        self._save(m)
        self.s.db.execute("INSERT INTO tf_transitions(order_id, idx, request_id, from_state, to_state, at, note) "
                          "VALUES (?, ?, ?, ?, ?, ?, ?)", (m["order_id"], m["idx"], m["request_id"], frm, to,
                                                           time.time(), note[:500]))
        row = None
        if ledger is not None and to in LEDGER_KIND:
            payload = {"orderId": m["order_id"], "index": m["idx"], "from": frm, "state": to, "reason": reason,
                       "note": note, **ledger}
            row = self.s.ledger.append(LEDGER_KIND[to], m["buyer"], payload, request_id=m["request_id"],
                                       **ledger_kw)
        self.s.bus.publish({"type": "tradeflow", "safe": m["buyer"], "orderId": str(m["order_id"]),
                            "index": m["idx"], "from": frm, "state": to, "reason": reason,
                            "requestId": m["request_id"]})
        return row

    def _load(self, order_id: int) -> tuple[Order, list[tuple[MilestoneTerms, int]]]:
        return self.chain.escrow_order(order_id), self.chain.escrow_milestones(order_id)

    def track_order(self, order: Order, tx: str | None = None, block: int | None = None) -> dict:
        """Start serving an order of a served tenant. Beyond the active-order cap the order is recorded unserved."""
        with self._lock(order.orderId):
            row = self.order_row(order.orderId)
            if row is not None:
                if tx and not row["created_tx"]:
                    self.s.db.execute("UPDATE tf_orders SET created_tx=?, created_block=? WHERE order_id=?",
                                      (tx, block, order.orderId))
                return self.order_row(order.orderId)
            active = self.s.db.one("SELECT COUNT(*) AS n FROM tf_orders WHERE buyer=? AND status='ACTIVE' AND "
                                   "served=1", (order.buyer.lower(),))["n"]
            served = int(active < self.settings.tradeflow.max_active_orders)
            ms = self.chain.escrow_milestones(order.orderId)
            now = time.time()
            self.s.db.execute(
                "INSERT INTO tf_orders(order_id, buyer, supplier, total, terms_hash, created_at, created_tx, "
                "created_block, status, served, seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)",
                (order.orderId, order.buyer.lower(), order.supplier, str(order.total), hex32(order.termsHash),
                 order.createdAt, tx, block, served, now))
            for i in range(3):
                self.s.db.execute("INSERT INTO tf_milestones(order_id, idx, buyer, state, reason, request_id, data, "
                                  "updated_at) VALUES (?, ?, ?, 'AWAITING_PROOF', NULL, NULL, '{}', ?)",
                                  (order.orderId, i, order.buyer.lower(), now))
            self.s.ledger.append("ORDER_CREATED", order.buyer, {
                "orderId": order.orderId, "supplier": order.supplier, "total": str(order.total),
                "termsHash": hex32(order.termsHash), "served": bool(served),
                "milestones": [t.to_json() for t, _ in ms]}, tx_hash=tx)
            if not served:
                self.s.alert("warning", "ActiveOrderLimit", f"order {order.orderId} is not served: at most "
                             f"{self.settings.tradeflow.max_active_orders} active orders per treasury", order.buyer)
            self.s.bus.publish({"type": "tradeflow", "safe": order.buyer, "orderId": str(order.orderId),
                                "event": "ORDER_CREATED", "served": bool(served)})
            return self.order_row(order.orderId)

    def _store_proof(self, order_id: int, index: int, proof: MilestoneProof, signature: str, proof_hash: str,
                     document_hash: str | None, source: str) -> int:
        cur = self.s.db.execute("INSERT INTO tf_proofs(order_id, idx, proof_hash, proof, signature, document_hash, "
                                "source, received_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                                (order_id, index, proof_hash, json.dumps(proof.to_json()), signature, document_hash,
                                 source, time.time()))
        return cur.lastrowid

    def _proof(self, proof_id: int) -> tuple[MilestoneProof, str, dict]:
        row = self.s.db.one("SELECT * FROM tf_proofs WHERE id=?", (proof_id,))
        return MilestoneProof.from_json(json.loads(row["proof"])), row["signature"], row

    def _confirmation(self, order_id: int, index: int, proof_hash: str) -> tuple[ReleaseConfirmation, str] | None:
        row = self.s.db.one("SELECT * FROM tf_confirmations WHERE order_id=? AND idx=? AND proof_hash=? ORDER BY "
                            "expiry DESC LIMIT 1", (order_id, index, proof_hash.lower()))
        if row is None:
            return None
        return ReleaseConfirmation(order_id, index, to_bytes32(proof_hash), int(row["expiry"])), row["signature"]

    def submit_proof(self, order_id: int, index, proof_json, signature, document: bytes | None,
                     source: str = "submitted") -> dict:
        """POST /proofs. Admission first (C4); only an admitted, issuer-signed proof can change state."""
        adm = self.verifier.admit(order_id, index, proof_json, signature, document, self.served)
        self.track_order(adm.order)
        with self._lock(order_id):
            if not self.order_row(order_id)["served"]:
                raise reject(409, "ActiveOrderLimit", "this order is beyond the treasury's active-order limit")
            m = self.milestone(order_id, index)
            if m["state"] in IN_FLIGHT:
                raise reject(409, "ReleaseInProgress", f"milestone is {m['state']}")
            if m["state"] in TERMINAL:
                raise reject(409, "MilestoneAlreadyPaid")
            if not self.s.limiter.hit("tf_proof_order", str(order_id), self.settings.tradeflow.proofs_per_order_hour,
                                      3600):
                raise WorkflowError(429, "RateLimited", "proof submissions for this order are limited per hour")
            proof_id = self._store_proof(order_id, index, adm.proof, signature, adm.proof_hash, adm.document_hash,
                                         source)
            if m["state"] == "HELD":
                # After a hold, a later proof needs the owner's ReleaseConfirmation before any release (C8).
                m["data"]["pendingProofId"] = proof_id
                self._save(m)
                self.s.ledger.append("PROOF_RECEIVED", m["buyer"], {
                    "orderId": order_id, "index": index, "proofHash": adm.proof_hash, "source": source,
                    "awaitingConfirmation": True, "state": "HELD", "heldReason": m["reason"],
                    "documentHash": adm.document_hash}, request_id=m["request_id"])
                return self._result(m, adm.proof_hash, awaiting_confirmation=True)
            m["request_id"] = f"rel_{uuid.uuid4().hex[:16]}"
            m["data"].update({"proofId": proof_id, "resigns": 0, "pendingProofId": None})
            self._process(m, adm.order, adm.terms, f"proof from {source}")
            return self._result(m, adm.proof_hash)

    def _result(self, m: dict, proof_hash: str, awaiting_confirmation: bool = False) -> dict:
        m = self.milestone(m["order_id"], m["idx"])
        out = {"admitted": True, "orderId": str(m["order_id"]), "index": m["idx"], "proofHash": proof_hash,
               "requestId": m["request_id"], "state": m["state"], "reason": m["reason"]}
        if awaiting_confirmation:
            out["awaitingConfirmation"] = True
        return out

    def _process(self, m: dict, order: Order, terms: MilestoneTerms, trigger: str) -> None:
        """Enter PROOF_RECEIVED with the check results, then follow the verdict."""
        proof, signature, prow = self._proof(m["data"]["proofId"])
        verdict = self.verifier.evaluate(order, terms, proof, self._confirmation(m["order_id"], m["idx"],
                                                                                 prow["proof_hash"]))
        self._move(m, "PROOF_RECEIVED", trigger, {
            "proofHash": prow["proof_hash"], "proof": json.loads(prow["proof"]),
            "source": prow["source"], "documentHash": prow["document_hash"], "checks": verdict.checks,
            "verdict": verdict.outcome, "verdictReason": verdict.reason, "trigger": trigger, "now": verdict.now})
        self._follow(m, order, terms, proof, signature, verdict)

    def _follow(self, m: dict, order: Order, terms: MilestoneTerms, proof: MilestoneProof, signature: str,
                verdict: Verdict) -> None:
        if verdict.outcome == "waiting":
            self._wait(m, verdict.reason, verdict.waiting_on, terms, verdict.checks)
        elif verdict.outcome == "held":
            self._hold(m, verdict.reason, terms, verdict.checks)
        else:
            self._explain(m, terms, "PROOF_VERIFIED", None, verdict.checks)
            self._move(m, "PROOF_VERIFIED", "every check passed")
            self._request_release(m, order, terms, proof, signature)

    def _wait(self, m: dict, reason: str, waiting_on: dict, terms: MilestoneTerms, checks: list[dict]) -> None:
        m["data"]["waitingOn"] = waiting_on
        self._explain(m, terms, "WAITING", reason, checks)
        self._move(m, "WAITING", f"waiting: {reason}", {"waitingOn": waiting_on,
                                                        "explanation": m["data"].get("explanation")}, reason=reason)

    def _hold(self, m: dict, reason: str, terms: MilestoneTerms, checks: list[dict]) -> None:
        m["data"]["heldBefore"] = True
        self._explain(m, terms, "HELD", reason, checks)
        failed = [c for c in checks if not c["ok"]]
        self._move(m, "HELD", f"held: {reason}", {"failedChecks": failed,
                                                  "explanation": m["data"].get("explanation")}, reason=reason)

    def _explain(self, m: dict, terms: MilestoneTerms, state: str, reason: str | None, checks: list[dict]) -> None:
        proof_json = None
        if m["data"].get("proofId"):
            proof_json = self._proof(m["data"]["proofId"])[0].to_json()
        facts = vagent.facts_for(m["order_id"], m["idx"], terms, state, reason, checks, proof_json)
        with self.agent.request(m["buyer"]):
            m["data"]["explanation"] = vagent.explain(self.agent, facts)

    def _current_waiting_on(self, order: Order) -> dict:
        return {"policyVersion": self.chain.policy(order.buyer, []).policy_version, "nextIndex": order.nextIndex}

    def _classify(self, m: dict, code: str, order: Order, terms: MilestoneTerms, source: str) -> None:
        if code in WAITING_REASONS:
            self._wait(m, code, self._current_waiting_on(order), terms, [{"name": code, "ok": False,
                                                                           "detail": source}])
        else:
            reason = code if code in HELD_REASONS else f"ReleaseFailed:{code}"
            self._hold(m, reason, terms, [{"name": code, "ok": False, "detail": source}])

    def _request_release(self, m: dict, order: Order, terms: MilestoneTerms, proof: MilestoneProof,
                         issuer_sig: str) -> None:
        """PROOF_VERIFIED: checkRelease, then the Authorizer's own re-verification and signature."""
        s, tf = self.settings, self.settings.tradeflow
        prow = self._proof(m["data"]["proofId"])[2]
        for attempt in range(2):
            pol = self.chain.policy(order.buyer, [])
            now = self.chain.block_timestamp()
            auth = ReleaseAuthorization(order.orderId, m["idx"], terms.amount, to_bytes32(prow["proof_hash"]),
                                        pol.policy_version, random_nonce(), now + tf.auth_expiry)
            check = self.chain.escrow_check_release(order.orderId, m["idx"], proof, auth)
            if not check.ok:
                self._classify(m, check.error or "CheckFailed", order, terms, "checkRelease")
                return
            conf = self._confirmation(order.orderId, m["idx"], prow["proof_hash"])
            payload = {"requestId": m["request_id"], "safe": order.buyer, "orderId": str(order.orderId),
                       "index": m["idx"], "proof": proof.to_json(), "issuerSignature": issuer_sig,
                       "authorization": auth.to_json(), "priorHold": bool(m["data"].get("heldBefore")),
                       "confirmation": {**conf[0].to_json(), "signature": conf[1]} if conf else None}
            try:
                signed = self.authorizer.sign_release(payload)
            except AuthorizerRefused as e:
                code = refusal_code(e)
                if code in ("PolicyVersionMismatch", "ExpiryOutOfRange") and attempt == 0:
                    continue
                if code in ("AuthorizerUnavailable", "AuthorizerError"):
                    m["data"]["lastError"] = str(e)
                    self._save(m)
                    return
                self._classify(m, code, order, terms, f"Authorizer refused: {e}")
                return
            auth_hash = hex32(auth_digest(s.chain_id, s.addresses.trade_escrow, auth))
            if signed.get("authHash", auth_hash).lower() != auth_hash.lower():
                raise WorkflowError(500, "AuthHashMismatch")
            release = {"orderId": str(order.orderId), "index": m["idx"], "proof": proof.to_json(),
                       "issuerSig": issuer_sig, "auth": auth.to_json(), "authSig": signed["signature"]}
            sub_id = enqueue_release(self.s, order.buyer, release, auth_hash, m["request_id"])
            m["data"].update({"authorization": auth.to_json(), "authHash": auth_hash, "submissionId": sub_id,
                              "lastError": None})
            self._move(m, "RELEASE_SIGNED", f"submission {sub_id}", {
                "authorization": auth.to_json(), "authHash": auth_hash, "signer": signed.get("signer"),
                "submissionId": sub_id, "resigns": m["data"].get("resigns", 0)}, dar_hash=auth_hash)
            return

    def apply_release_results(self) -> int:
        """The Executor's report for every release submission: sent, confirmed, reverted, or a failed preflight."""
        rows = self.s.db.query("SELECT * FROM submissions WHERE source='release' AND applied=0 AND status IN "
                               "('sent','confirmed','reverted','failed') ORDER BY id")
        n = 0
        for sub in rows:
            release = json.loads(sub["dar"])
            order_id, index = int(release["orderId"]), int(release["index"])
            with self._lock(order_id):
                m = self.milestone(order_id, index)
                current = m["data"].get("submissionId") == sub["id"] and m["state"] in ("RELEASE_SIGNED",
                                                                                         "RELEASE_SUBMITTED")
                if not current:
                    self.s.db.execute("UPDATE submissions SET applied=1 WHERE id=?", (sub["id"],))
                    continue
                if sub["tx_hash"] and m["state"] == "RELEASE_SIGNED":
                    self._move(m, "RELEASE_SUBMITTED", f"tx {sub['tx_hash']} from {sub['claimed_by']}")
                if sub["status"] == "sent":
                    continue
                self.s.db.execute("UPDATE submissions SET applied=1 WHERE id=?", (sub["id"],))
                n += 1
                result = json.loads(sub["result"] or "{}")
                if sub["status"] == "confirmed":
                    ev = result.get("executed") or {}
                    self._paid(m, {**ev, "txHash": sub["tx_hash"], "waived": False}, by=sub["claimed_by"])
                    continue
                selector = (sub["error"] or "Reverted").split(":", 1)[0].strip()
                stage = "revert" if sub["tx_hash"] else "preflight"
                self._move(m, "RELEASE_FAILED", f"{stage}: {selector}", {
                    "selector": selector, "stage": stage, "submissionId": sub["id"],
                    "resigns": m["data"].get("resigns", 0)}, reason=selector, tx_hash=sub["tx_hash"],
                    revert_reason=selector, dar_hash=sub["dar_hash"])
                self._after_failure(m, selector)
        return n

    def _after_failure(self, m: dict, selector: str) -> None:
        """RELEASE_FAILED (C7): WAITING if the cause is now transient; at most two re-signs for PolicyVersionMismatch,
        Expired or NonceUsed; anything else ends HELD ReleaseFailed:<selector>."""
        order, ms = self._load(m["order_id"])
        terms, status = ms[m["idx"]]
        if not order.active or status != PENDING:
            # Someone else's release (or a waive or refund) was mined first; the event settles this milestone.
            self.sync_chain()
            return
        proof, signature, prow = self._proof(m["data"]["proofId"])
        verdict = self.verifier.evaluate(order, terms, proof, self._confirmation(order.orderId, m["idx"],
                                                                                 prow["proof_hash"]))
        if verdict.outcome == "waiting":
            self._wait(m, verdict.reason, verdict.waiting_on, terms, verdict.checks)
            return
        resigns = m["data"].get("resigns", 0)
        if selector in RETRYABLE and resigns < self.settings.tradeflow.max_resigns:
            m["data"]["resigns"] = resigns + 1
            self._move(m, "PROOF_RECEIVED", f"re-sign {resigns + 1} after {selector}", {
                "proofHash": prow["proof_hash"], "checks": verdict.checks, "verdict": verdict.outcome,
                "verdictReason": verdict.reason, "trigger": f"ReleaseFailed:{selector}", "now": verdict.now})
            self._follow(m, order, terms, proof, signature, verdict)
            return
        self._hold(m, f"ReleaseFailed:{selector}", terms, [{"name": selector, "ok": False,
                                                            "detail": f"release failed after {resigns} re-signs"}])

    def _paid(self, m: dict, ev: dict, by: str | None = None) -> None:
        """RELEASED or WAIVED, from the Executor's receipt or from a MilestoneReleased event."""
        if m["state"] in TERMINAL:
            return
        ours = bool(ev.get("authHash")) and ev.get("authHash", "").lower() == (m["data"].get("authHash") or "").lower()
        if ours and m["state"] == "RELEASE_SIGNED":
            self._move(m, "RELEASE_SUBMITTED", f"tx {ev.get('txHash')}")
        target = "WAIVED" if ev.get("waived") else "RELEASED"
        m["data"]["settlementTx"] = ev.get("txHash")
        external = not (ours and m["state"] == "RELEASE_SUBMITTED")
        self._move(m, target, "waived by the owner" if target == "WAIVED" else
                   ("released by the service" if not external else "released by another submitter"),
                   {"amount": str(ev.get("amount", "")), "supplier": ev.get("supplier"),
                    "proofHash": ev.get("proofHash"), "authHash": ev.get("authHash"), "waived": target == "WAIVED",
                    "submittedBy": by or ("service" if not external else "other"),
                    "block": ev.get("blockNumber")},
                   external=external, tx_hash=ev.get("txHash"), dar_hash=ev.get("authHash") or None)
        self._refresh_order(m["order_id"])

    def _refresh_order(self, order_id: int) -> None:
        order = self.chain.escrow_order(order_id)
        if order.status == 2:
            self.s.db.execute("UPDATE tf_orders SET status='COMPLETED' WHERE order_id=?", (order_id,))
            self._close_open(order_id, "RELEASED")

    def _close_open(self, order_id: int, fallback: str) -> list[dict]:
        """An order that is no longer active ends every open milestone with the terminal reason OrderNotActive."""
        statuses = self.chain.escrow_milestones(order_id)
        closed = []
        for i in range(3):
            m = self.milestone(order_id, i)
            if m["state"] in TERMINAL:
                continue
            target = {1: "RELEASED", 2: "WAIVED", 3: "REFUNDED"}.get(statuses[i][1], fallback)
            closed.append({"index": i, "from": m["state"], "to": target, "reason": "OrderNotActive"})
            self._move(m, target, "order no longer active", None, reason="OrderNotActive", external=True)
        return closed

    def sync_chain(self) -> int:
        """Read OrderCreated, MilestoneReleased and OrderRefunded since the last scanned block."""
        head = self.chain.block_number()
        start = int(self.s.db.kv_get(SCAN_KEY, self.settings.addresses.trade_escrow_block - 1)) + 1
        if start > head:
            return 0
        events = self.chain.escrow_events(max(start, 0), head)
        for ev in events:
            self._on_event(ev)
        self.s.db.kv_set(SCAN_KEY, head)
        return len(events)

    def _on_event(self, ev: dict) -> None:
        order_id = int(ev["orderId"])
        if ev["event"] == "OrderCreated":
            if self.served(ev["buyer"]):
                self.track_order(self.chain.escrow_order(order_id), ev.get("txHash"), ev.get("blockNumber"))
            return
        row = self.order_row(order_id)
        if row is None:
            return
        with self._lock(order_id):
            if ev["event"] == "MilestoneReleased":
                self._paid(self.milestone(order_id, int(ev["index"])), ev)
                return
            if row["status"] == "REFUNDED":
                return
            self.s.db.execute("UPDATE tf_orders SET status='REFUNDED', refund_tx=? WHERE order_id=?",
                              (ev.get("txHash"), order_id))
            closed = self._close_open(order_id, "REFUNDED")
            self.s.ledger.append("ORDER_REFUNDED", row["buyer"], {
                "orderId": order_id, "amount": str(ev["amount"]), "buyer": ev["buyer"], "closed": closed,
                "block": ev.get("blockNumber")}, tx_hash=ev.get("txHash"))
            self.s.bus.publish({"type": "tradeflow", "safe": row["buyer"], "orderId": str(order_id),
                                "event": "ORDER_REFUNDED"})

    def recheck_waiting(self) -> int:
        """C5: a WAITING milestone is checked again after a PolicyChanged event of the buyer (every registry change
        bumps policyVersion) or a MilestoneReleased event of the order (nextIndex moves)."""
        n = 0
        for row in self.s.db.query("SELECT order_id, idx FROM tf_milestones WHERE state='WAITING'"):
            with self._lock(row["order_id"]):
                m = self.milestone(row["order_id"], row["idx"])
                if m["state"] != "WAITING":
                    continue
                order, ms = self._load(m["order_id"])
                if not order.active:
                    continue
                was = m["data"].get("waitingOn") or {}
                now = self._current_waiting_on(order)
                triggers = [t for t, k in (("PolicyChanged", "policyVersion"), ("MilestoneReleased", "nextIndex"))
                            if was.get(k) != now[k]]
                if not triggers:
                    continue
                self._process(m, order, ms[m["idx"]][0], "+".join(triggers))
                n += 1
        return n

    def resume_stuck(self) -> int:
        """Recovery: a milestone left in PROOF_RECEIVED or PROOF_VERIFIED (a crash, or an Authorizer outage) is
        verified again."""
        n = 0
        cutoff = time.time() - STUCK_AFTER
        for row in self.s.db.query("SELECT order_id, idx FROM tf_milestones WHERE state IN "
                                   "('PROOF_RECEIVED','PROOF_VERIFIED') AND updated_at < ?", (cutoff,)):
            with self._lock(row["order_id"]):
                m = self.milestone(row["order_id"], row["idx"])
                if m["state"] not in ("PROOF_RECEIVED", "PROOF_VERIFIED") or m["updated_at"] >= cutoff:
                    continue
                order, ms = self._load(m["order_id"])
                if not order.active or ms[m["idx"]][1] != PENDING:
                    continue
                proof, signature, prow = self._proof(m["data"]["proofId"])
                if m["state"] == "PROOF_VERIFIED":
                    self._request_release(m, order, ms[m["idx"]][0], proof, signature)
                else:
                    verdict = self.verifier.evaluate(order, ms[m["idx"]][0], proof,
                                                     self._confirmation(order.orderId, m["idx"], prow["proof_hash"]))
                    self._follow(m, order, ms[m["idx"]][0], proof, signature, verdict)
                n += 1
        return n

    def tick(self) -> None:
        self.apply_release_results()
        self.sync_chain()
        self.recheck_waiting()
        self.resume_stuck()

    def _session_order(self, session: Session, order_id: int) -> dict:
        row = self.order_row(order_id)
        if row is None or session.role != "owner" or not session.safe or row["buyer"] != session.safe.lower():
            raise WorkflowError(404, "NotFound", "no such order for this session")
        return row

    def demo_proof(self, session: Session, order_id: int, index, variant: str) -> dict:
        self._session_order(session, order_id)
        if isinstance(index, bool) or not isinstance(index, int) or not 0 <= index <= 2:
            raise WorkflowError(422, "BadIndex", "index must be 0, 1 or 2")
        if not self.s.limiter.hit("tf_demo", session.safe.lower(), self.settings.tradeflow.demo_proofs_per_tenant_hour,
                                  3600):
            raise WorkflowError(429, "RateLimited", "demo proofs are limited per treasury per hour")
        order, ms = self._load(order_id)
        terms = ms[index][0]
        demo = self.issuers.for_issuer(terms.issuer)
        if demo is None:
            raise WorkflowError(403, "NotDemoIssuer", "this milestone's issuer is not a demo issuer key")
        try:
            proof, signature, document = self.issuers.build(demo[0], demo[1], order, index, terms, variant,
                                                            self.chain.head_timestamp())
        except ValueError as e:
            raise WorkflowError(400, "BadVariant", str(e)) from None
        return self.submit_proof(order_id, index, proof.to_json(), signature, document, f"demo:{demo[0]}")

    def confirm(self, session: Session, order_id: int, index, proof_hash: str, expiry, signature: str) -> dict:
        """POST /confirm: the owner's EIP-712 ReleaseConfirmation for a late release or a corrected proof (C8)."""
        row = self._session_order(session, order_id)
        try:
            conf = ReleaseConfirmation.from_json({"orderId": order_id, "index": index, "proofHash": proof_hash,
                                                  "expiry": expiry})
        except (KeyError, TypeError, ValueError) as e:
            raise WorkflowError(400, "BadConfirmation", str(e)) from None
        s = self.settings
        owner = self.chain.policy(row["buyer"], []).owner
        signer = recover_digest(confirmation_digest(s.chain_id, s.addresses.trade_escrow, conf), signature or "")
        if signer is None or signer.lower() != owner.lower() or session.address.lower() != owner.lower():
            raise WorkflowError(400, "BadSignature", "the ReleaseConfirmation must be signed by the registry owner")
        if conf.expiry <= self.chain.block_timestamp():
            raise WorkflowError(400, "ConfirmationExpired")
        ph = hex32(to_bytes32(proof_hash)).lower()
        with self._lock(order_id):
            prow = self.s.db.one("SELECT * FROM tf_proofs WHERE order_id=? AND idx=? AND proof_hash=? ORDER BY id DESC "
                                 "LIMIT 1", (order_id, conf.index, ph))
            if prow is None:
                raise WorkflowError(404, "UnknownProof", "no admitted proof with that proofHash for this milestone")
            self.s.db.execute("INSERT OR REPLACE INTO tf_confirmations(order_id, idx, proof_hash, expiry, signature, "
                              "signer, at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                              (order_id, conf.index, ph, conf.expiry, signature, signer, time.time()))
            m = self.milestone(order_id, conf.index)
            self.s.ledger.append("RELEASE_CONFIRMED", row["buyer"], {
                "orderId": order_id, "index": conf.index, "proofHash": ph, "expiry": conf.expiry, "signer": signer,
                "state": m["state"]}, request_id=m["request_id"])
            if m["state"] == "HELD":
                if m["data"].get("proofId") != prow["id"]:
                    m["request_id"] = f"rel_{uuid.uuid4().hex[:16]}"
                    m["data"]["resigns"] = 0
                m["data"].update({"proofId": prow["id"], "pendingProofId": None})
                order, ms = self._load(order_id)
                if order.active and ms[conf.index][1] == PENDING:
                    self._process(m, order, ms[conf.index][0], "ReleaseConfirmation")
        return self.full_view(order_id)

    def link_obligation(self, session: Session, order_id: int, obligation_id: str) -> dict:
        """Settles the obligation this order pays, so the same payment is not reserved twice. The floor update is
        returned as parameters; the web encodes setReserveFloor itself (C1)."""
        row = self._session_order(session, order_id)
        if row["obligation_id"]:
            raise WorkflowError(409, "AlreadyLinked")
        ob = self.s.obligations.settle(session.safe, obligation_id)
        if ob is None:
            raise WorkflowError(404, "NotFound", "no unsettled obligation with that id for this Safe")
        self.s.db.execute("UPDATE tf_orders SET obligation_id=? WHERE order_id=?", (ob.id, order_id))
        res = required_reserve(self.s.obligations.list(session.safe, False), self.chain.block_timestamp(),
                               self.settings.params)
        floor = {"floor": amount(res.required), "scheduleHash": res.schedule_hash}
        self.s.ledger.append("OBLIGATION_SETTLED", session.safe, {"obligation": obligation_json(ob),
                                                                  "orderId": order_id, "floorUpdate": floor})
        return {"obligation": obligation_json(ob), "floorUpdate": floor}

    def public_view(self, order_id: int) -> dict | None:
        """On-chain fields only (C9): terms, statuses and settlement transaction hashes."""
        order, ms = self._load(order_id)
        if not order.exists:
            return None
        row = self.order_row(order_id) or {}
        txs = {"created": row.get("created_tx"), "refund": row.get("refund_tx"), "milestones": {}}
        milestones = []
        for i, (terms, status) in enumerate(ms):
            m = self.milestone(order_id, i) if row else None
            tx = (m or {}).get("data", {}).get("settlementTx") if m else None
            if tx:
                txs["milestones"][str(i)] = tx
            milestones.append({"index": i, **terms.to_json(), "amount": amount(terms.amount),
                               "status": MILESTONE_STATUS[status]})
        return {"order": {**order.to_json(), "total": amount(order.total), "released": amount(order.released)},
                "milestones": milestones, "transactions": txs, "view": "public"}

    def full_view(self, order_id: int) -> dict:
        out = self.public_view(order_id)
        if out is None or self.order_row(order_id) is None:
            raise WorkflowError(404, "NotFound")
        row = self.order_row(order_id)
        order, ms = self._load(order_id)
        now = self.chain.block_timestamp()
        pol = self.chain.policy(order.buyer, [])
        refund_after = ms[order.nextIndex][0].deadline if order.active and order.nextIndex < 3 else None
        for i, view in enumerate(out["milestones"]):
            m = self.milestone(order_id, i)
            proofs = [self._proof_view(p) for p in self.s.db.query(
                "SELECT * FROM tf_proofs WHERE order_id=? AND idx=? ORDER BY id", (order_id, i))]
            current = next((p for p in proofs if p["id"] == m["data"].get("proofId")), None)
            pending = next((p for p in proofs if p["id"] == m["data"].get("pendingProofId")), None)
            open_ = m["state"] not in TERMINAL and order.active and i == order.nextIndex
            confirm_for = pending or (current if m["state"] == "HELD" and m["reason"] == "DeadlinePassed" else None)
            view.update({
                "state": m["state"], "reason": m["reason"], "requestId": m["request_id"], "proof": current,
                "pendingProof": pending, "proofs": proofs, "explanation": m["data"].get("explanation"),
                "waitingOn": m["data"].get("waitingOn") if m["state"] == "WAITING" else None,
                "authorization": m["data"].get("authorization"), "resigns": m["data"].get("resigns", 0),
                "resolution": {
                    "orderId": str(order_id), "index": i,
                    "canWaive": m["state"] == "HELD" and open_ and not (pol.owner_frozen or pol.bank_frozen),
                    "canRefund": order.active and refund_after is not None and now > refund_after,
                    "refundAfter": refund_after,
                    "confirmation": {"orderId": str(order_id), "index": i, "proofHash": confirm_for["proofHash"],
                                     "expiry": now + self.settings.tradeflow.confirmation_expiry}
                    if confirm_for and m["state"] == "HELD" else None,
                },
                "history": [{"from": t["from_state"], "to": t["to_state"], "at": t["at"], "note": t["note"],
                             "requestId": t["request_id"]} for t in self.s.db.query(
                    "SELECT * FROM tf_transitions WHERE order_id=? AND idx=? ORDER BY id", (order_id, i))],
                "ledgerRef": self.ledger_refs(order_id, i),
            })
        out.update({"view": "full", "served": bool(row["served"]), "obligationId": row["obligation_id"],
                    "orderLedgerRef": self.ledger_refs(order_id, None)})
        return out

    def _proof_view(self, p: dict) -> dict:
        return {"id": p["id"], "proofHash": p["proof_hash"], "proof": json.loads(p["proof"]),
                "issuerSignature": p["signature"], "source": p["source"], "documentHash": p["document_hash"],
                "receivedAt": p["received_at"]}

    def ledger_refs(self, order_id: int, index: int | None) -> list[dict]:
        if index is None:
            rows = self.s.db.query("SELECT id, kind, row_hash, prev_hash, tx_hash, request_id FROM ledger WHERE "
                                   "kind IN ('ORDER_CREATED','ORDER_REFUNDED','OBLIGATION_SETTLED') AND "
                                   "json_extract(payload, '$.orderId')=? ORDER BY id", (order_id,))
        else:
            rows = self.s.db.query("SELECT id, kind, row_hash, prev_hash, tx_hash, request_id FROM ledger WHERE "
                                   "json_extract(payload, '$.orderId')=? AND json_extract(payload, '$.index')=? "
                                   "ORDER BY id", (order_id, index))
        return [{"ledgerId": r["id"], "kind": r["kind"], "rowHash": r["row_hash"], "prevHash": r["prev_hash"],
                 "txHash": r["tx_hash"], "requestId": r["request_id"]} for r in rows]

    def orders_for(self, safes: set[str]) -> list[dict]:
        rows = [r for r in self.s.db.query("SELECT order_id, buyer FROM tf_orders ORDER BY order_id DESC")
                if r["buyer"] in safes]
        return [self.full_view(r["order_id"]) for r in rows]

    def committed(self, safe: str) -> int:
        return self.chain.escrow_committed_of(safe)

    def bank_summary(self, safe: str, events: list[dict]) -> dict:
        rows = self.s.db.query("SELECT * FROM tf_orders WHERE buyer=?", (safe.lower(),))
        held = [{"orderId": str(m["order_id"]), "index": m["idx"], "reason": m["reason"]} for m in self.s.db.query(
            "SELECT order_id, idx, reason FROM tf_milestones WHERE buyer=? AND state='HELD' ORDER BY order_id, idx",
            (safe.lower(),))]
        waiting = self.s.db.one("SELECT COUNT(*) AS n FROM tf_milestones WHERE buyer=? AND state='WAITING'",
                                (safe.lower(),))["n"]
        return {"activeOrders": sum(1 for r in rows if r["status"] == "ACTIVE"),
                "committed": amount(self.committed(safe)), "heldMilestones": held, "waitingMilestones": waiting,
                "reconciliation": self.reconcile(safe, events)}

    def reconcile(self, safe: str, events: list[dict]) -> dict:
        """MilestoneReleased and OrderRefunded events of this buyer's orders against the settlement ledger rows."""
        orders = {r["order_id"] for r in self.s.db.query("SELECT order_id FROM tf_orders WHERE buyer=?",
                                                          (safe.lower(),))}

        def key(order_id, index, tx) -> tuple:
            return int(order_id), index, (tx or "").lower()

        chain = {}
        for e in events:
            if e["event"] in ("MilestoneReleased", "OrderRefunded") and int(e["orderId"]) in orders:
                chain[key(e["orderId"], e.get("index"), e["txHash"])] = e
        led = {}
        for r in self.s.ledger.rows(safe, limit=100_000):
            if r["kind"] in SETTLEMENT_KINDS and isinstance(r["payload"], dict):
                index = None if r["kind"] == "ORDER_REFUNDED" else r["payload"].get("index")
                led[key(r["payload"]["orderId"], index, r["tx_hash"])] = r
        details = [{"type": "event_without_ledger_row", "event": e["event"], "orderId": str(e["orderId"]),
                    "index": e.get("index"), "txHash": e["txHash"]} for k, e in chain.items() if k not in led]
        details += [{"type": "ledger_row_without_event", "kind": r["kind"], "ledgerId": r["id"],
                     "txHash": r["tx_hash"]} for k, r in led.items() if k not in chain]
        return {"mismatches": len(details), "details": details, "chainSettlements": len(chain),
                "ledgerSettlements": len(led)}


def enqueue_release(services: Services, buyer: str, release: dict, auth_hash: str, request_id: str) -> int:
    """A release joins the Executor's queue as submission kind op=2 (the DAR kinds are 0 and 1)."""
    now = time.time()
    cur = services.db.execute(
        "INSERT INTO submissions(source, op, request_id, safe, vault, dar, sigs, approval, dar_hash, status, "
        "created_block, created_at, updated_at) VALUES ('release', ?, ?, ?, ?, ?, ?, NULL, ?, 'pending', ?, ?, ?)",
        (OP_RELEASE, request_id, buyer.lower(), services.settings.addresses.trade_escrow.lower(), json.dumps(release),
         json.dumps({"issuer": release["issuerSig"], "auth": release["authSig"]}), auth_hash,
         services.chain.block_number(), now, now))
    services.bus.publish({"type": "submission", "safe": buyer, "submissionId": cur.lastrowid, "source": "release",
                          "darHash": auth_hash, "status": "pending"})
    return cur.lastrowid
