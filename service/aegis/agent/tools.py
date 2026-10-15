"""Agent tools (TECHNICAL-DOCUMENT 02). Every tool is bound to the session's Safe at construction.

No tool takes a Safe, address or calldata argument. Unknown arguments are dropped and flagged.
"""

from __future__ import annotations

from aegis.agent.llm import quoted
from aegis.core.pipeline import Snapshot
from aegis.core.validator import validate
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
TOOL_NAMES = [t["function"]["name"] for t in TOOL_SCHEMAS]
ALLOWED_ARGS = {"propose_action": {"option_id", "reductions"}, "explain_decision": {"request_id"}}


class AgentTools:
    def __init__(self, services: Services, safe: str, request_lookup=None):
        self._services = services
        self._safe = safe
        self._request_lookup = request_lookup
        self.snapshot: Snapshot | None = None
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
            self.snapshot = self._services.snapshot(self._safe)
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
