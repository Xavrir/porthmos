"""Agent tools (TECHNICAL-DOCUMENT 02). Every tool is bound to the session's Safe at construction.

No tool takes a Safe, address or calldata argument. Unknown arguments are dropped and flagged.
"""

from __future__ import annotations

import json
from concurrent.futures import Future

from aegis.agent.llm import quoted
from aegis.core.pipeline import Snapshot
from aegis.core.state import TreasuryState
from aegis.core.validator import validate
from aegis.eip712 import hex32
from aegis.obligations import to_json as obligation_json
from aegis.services import Services
from aegis.units import amount

TOOL_SCHEMAS = [
    {"type": "function", "function": {
        "name": "get_treasury_state", "description": "Balances, vault positions, oracle and policy for this treasury.",
        "parameters": {"type": "object", "properties": {}, "additionalProperties": False}}},
    {"type": "function", "function": {
        "name": "get_obligations", "description": "The owner-approved obligation schedule and required reserve.",
        "parameters": {"type": "object", "properties": {}, "additionalProperties": False}}},
    {"type": "function", "function": {
        "name": "get_risk_report", "description": "Per-vault risk score, components, exit triggers, quarantine.",
        "parameters": {"type": "object", "properties": {}, "additionalProperties": False}}},
    {"type": "function", "function": {
        "name": "plan_allocation", "description": "Deterministic plan options; one is marked default.",
        "parameters": {"type": "object", "properties": {}, "additionalProperties": False}}},
    {"type": "function", "function": {
        "name": "propose_action",
        "description": "Select a plan option by ID. Optional reductions may only lower the amount.",
        "parameters": {"type": "object", "properties": {
            "option_id": {"type": "string"},
            "reductions": {"type": "object", "properties": {"amount": {"type": "string",
                                                                       "description": "raw USDC units"}}},
        }, "required": ["option_id"], "additionalProperties": False}}},
    {"type": "function", "function": {
        "name": "explain_decision", "description": "Facts recorded for a request of this treasury.",
        "parameters": {"type": "object", "properties": {"request_id": {"type": "string"}},
                       "additionalProperties": False}}},
]
TOOL_SCHEMAS += [
    {"type": "function", "function": {
        "name": "get_orders", "description": "This treasury's TradeFlow orders, milestone states and escrowed total.",
        "parameters": {"type": "object", "properties": {}, "additionalProperties": False}}},
    {"type": "function", "function": {
        "name": "get_order", "description": "One TradeFlow order of this treasury with its milestones.",
        "parameters": {"type": "object", "properties": {"order_id": {"type": "integer"}}, "required": ["order_id"],
                       "additionalProperties": False}}},
    {"type": "function", "function": {
        "name": "explain_hold",
        "description": "Proof check results and hold or wait reason of one milestone (index 0 to 2) of this treasury.",
        "parameters": {"type": "object", "properties": {"order_id": {"type": "integer"}, "index": {"type": "integer"}},
                       "required": ["order_id"], "additionalProperties": False}}},
]
TOOL_NAMES = [t["function"]["name"] for t in TOOL_SCHEMAS]
ALLOWED_ARGS = {"propose_action": {"option_id", "reductions"}, "explain_decision": {"request_id"},
                "get_order": {"order_id"}, "explain_hold": {"order_id", "index"}}
NO_ORDER = {"error": "no such order for this treasury"}


class AgentTools:
    def __init__(self, services: Services, safe: str, request_lookup=None, tradeflow=None):
        self._services = services
        self._safe = safe
        self._request_lookup = request_lookup
        self._tradeflow = tradeflow
        self.snapshot: Snapshot | None = None
        self.prefetched: Future[TreasuryState] | None = None
        self.flags: list[str] = []
        self.selection: dict | None = None

    @property
    def safe(self) -> str:
        return self._safe

    def call(self, name: str, args: dict | None = None) -> dict:
        if name not in TOOL_NAMES:
            self.flags.append(f"unknownTool:{name}")
            return {"error": f"unknown tool {name}"}
        args = dict(args or {})
        allowed = ALLOWED_ARGS.get(name, set())
        dropped = sorted(set(args) - allowed)
        if dropped:
            self.flags.append(f"droppedArgs:{name}:{','.join(dropped)}")
            for k in dropped:
                args.pop(k)
        return getattr(self, name)(**args)

    def _snap(self, refresh: bool = False) -> Snapshot:
        if self.snapshot is None or refresh:
            state, self.prefetched = (self.prefetched.result() if self.prefetched else None), None
            self.snapshot = self._services.snapshot(self._safe, state)
        return self.snapshot

    def get_treasury_state(self, refresh: bool = False) -> dict:
        snap = self._snap(refresh)
        s = snap.state
        out = s.to_json()
        for v, raw in zip(out["vaults"], s.vaults):
            v["metadata"] = quoted(f"vault.name() at {raw.address}", raw.metadata_name)
        out["policy"] = {
            "autoCap": amount(s.policy.auto_cap), "dailyCap": amount(s.policy.daily_cap),
            "bankLimit": amount(s.policy.bank_limit), "reserveFloor": amount(s.policy.reserve_floor),
            "frozen": {"owner": s.policy.owner_frozen, "bank": s.policy.bank_frozen},
            "version": s.policy.policy_version,
        }
        return out

    def get_obligations(self) -> dict:
        snap = self._snap()
        return {
            "obligations": [obligation_json(o) for o in snap.obligations],
            "requiredReserve": amount(snap.reserve.required),
            "buffer": amount(snap.reserve.buffer),
            "peakNetOutflow": amount(snap.reserve.peak_net_outflow),
            "scheduleHash": snap.reserve.schedule_hash,
        }

    def get_risk_report(self) -> dict:
        return self._snap().risk.to_json()

    def plan_allocation(self) -> dict:
        return self._snap().plan.to_json()

    def propose_action(self, option_id: str, reductions: dict | None = None) -> dict:
        plan = self._snap().plan
        result = validate(plan, str(option_id), reductions)
        if result.ok:
            self.selection = {"optionId": str(option_id), "reductions": reductions or None}
        return {"accepted": result.ok, **result.to_json()}

    def explain_decision(self, request_id: str | None = None) -> dict:
        if not request_id or self._request_lookup is None:
            return {"error": "request_id required"}
        rec = self._request_lookup(request_id)
        if rec is None or rec["safe"].lower() != self._safe.lower():
            return {"error": "no such request for this treasury"}
        return {"requestId": rec["id"], "state": rec["state"], "outcome": rec["data"].get("outcome"),
                "history": rec.get("history", [])}

    def _order_row(self, order_id) -> dict | None:
        if self._tradeflow is None:
            return None
        try:
            oid = int(order_id)
        except (TypeError, ValueError):
            return None
        return self._services.db.one("SELECT * FROM tf_orders WHERE order_id=? AND buyer=?", (oid, self._safe.lower()))

    def get_orders(self) -> dict:
        if self._tradeflow is None:
            return {"enabled": False, "orders": [], "committed": amount(0)}
        rows = self._services.db.query("SELECT order_id FROM tf_orders WHERE buyer=? ORDER BY order_id",
                                       (self._safe.lower(),))
        return {"enabled": True, "committed": amount(self._services.chain.escrow_committed_of(self._safe)),
                "orders": [self._order_view(r["order_id"]) for r in rows]}

    def get_order(self, order_id=None) -> dict:
        row = self._order_row(order_id)
        return NO_ORDER if row is None else self._order_view(row["order_id"])

    def explain_hold(self, order_id=None, index=None) -> dict:
        from aegis.tradeflow import explain as vagent

        row = self._order_row(order_id)
        if row is None:
            return NO_ORDER
        tf, oid = self._tradeflow, row["order_id"]
        order, ms = tf._load(oid)
        states = [tf.milestone(oid, i) for i in range(len(ms))]
        if index is None:
            index = next((m["idx"] for m in states if m["state"] == "HELD"),
                         next((m["idx"] for m in states if m["state"] == "WAITING"), min(order.nextIndex, len(ms) - 1)))
        try:
            index = int(index)
        except (TypeError, ValueError):
            return {"error": "index must be 0, 1 or 2"}
        if not 0 <= index < len(ms):
            return {"error": "index must be 0, 1 or 2"}
        m, terms = states[index], ms[index][0]
        checks = self._latest_checks(oid, index, m["state"])
        proof_json = tf._proof(m["data"]["proofId"])[0].to_json() if m["data"].get("proofId") else None
        facts = vagent.facts_for(oid, index, terms, m["state"], m["reason"], checks, proof_json)
        if m["state"] in ("HELD", "WAITING", "PROOF_VERIFIED", "RELEASE_SIGNED", "RELEASED"):
            text = vagent.template(facts)
        else:
            text = (f"Milestone {index + 1} ({vagent.LABELS[terms.kind]}) of order {oid}, {facts['amount']} USDC, is "
                    f"{m['state'].replace('_', ' ').lower()}; it is not held.")
        explanation = (m["data"].get("explanation") or {}).get("text")
        return {"orderId": str(oid), "index": index, "state": m["state"], "reason": m["reason"],
                "failedChecks": facts["failedChecks"], "proposal": facts["proposal"], "text": text,
                "proof": facts.get("proof"),
                "explanation": quoted("Verification Agent explanation (model text)", explanation)
                if explanation else None}

    def _latest_checks(self, order_id: int, index: int, state: str) -> list[dict]:
        kind = "MILESTONE_HELD" if state == "HELD" else "PROOF_RECEIVED"
        row = self._services.db.one(
            "SELECT payload FROM ledger WHERE safe=? AND kind=? AND json_extract(payload, '$.orderId')=? AND "
            "json_extract(payload, '$.index')=? ORDER BY id DESC LIMIT 1", (self._safe.lower(), kind, order_id, index))
        if row is None:
            return []
        payload = json.loads(row["payload"])
        return payload.get("failedChecks") or payload.get("checks") or []

    def _order_view(self, order_id: int) -> dict:
        from aegis.tradeflow import explain as vagent
        from aegis.tradeflow.typed import ACTIVE, MILESTONE_STATUS

        tf = self._tradeflow
        row = tf.order_row(order_id)
        order, ms = tf._load(order_id)
        milestones, external = [], []
        for i, (terms, status) in enumerate(ms):
            m = tf.milestone(order_id, i)
            milestones.append({"index": i, "label": vagent.LABELS[terms.kind], "amount": amount(terms.amount),
                               "deadline": terms.deadline, "onchainStatus": MILESTONE_STATUS[status],
                               "state": m["state"], "reason": m["reason"]})
            proofs = self._services.db.query("SELECT proof_hash, document_hash FROM tf_proofs WHERE order_id=? AND "
                                             "idx=? ORDER BY id", (order_id, i))
            external.append({"index": i, "issuer": terms.issuer, "proofHashes": [p["proof_hash"] for p in proofs],
                             "documentHashes": [p["document_hash"] for p in proofs if p["document_hash"]]})
        label = None
        if row["obligation_id"]:
            ob = self._services.db.one("SELECT label FROM obligations WHERE id=? AND safe=?",
                                       (row["obligation_id"], self._safe.lower()))
            label = ob["label"] if ob else None
        return {
            "orderId": str(order_id), "status": row["status"], "served": bool(row["served"]),
            "total": amount(order.total), "released": amount(order.released),
            "committed": amount(order.total - order.released if order.status == ACTIVE else 0),
            "nextIndex": order.nextIndex, "milestones": milestones,
            "external": quoted(f"TradeEscrow order {order_id} terms and Porthmos order records", json.dumps(
                {"supplier": order.supplier, "termsHash": hex32(order.termsHash), "obligationLabel": label,
                 "milestones": external}, sort_keys=True)),
        }
