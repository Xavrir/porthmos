"""Glue for the deterministic core, shared by the API workflow and the Authorizer's re-verification."""

from __future__ import annotations

from dataclasses import dataclass, field

from aegis.chain.base import ChainClient
from aegis.config import Settings
from aegis.core import simulator
from aegis.core.actions import build_approval, build_dar, evidence_hash
from aegis.core.planner import Plan, build_plan
from aegis.core.policy import PolicyResult, verify
from aegis.core.reserve import Obligation, ReserveResult, required_reserve
from aegis.core.risk import RiskReport, assess
from aegis.core.state import TreasuryState, load_state
from aegis.core.validator import Validation, validate
from aegis.eip712 import DAR, OP_DEPOSIT, Approval, hex32


@dataclass
class Snapshot:
    state: TreasuryState
    obligations: list[Obligation]
    reserve: ReserveResult
    risk: RiskReport
    plan: Plan

    def versions(self) -> dict:
        return {**self.state.versions(), "scheduleHash": self.reserve.schedule_hash, "planHash": self.plan.plan_hash}


def snapshot(chain: ChainClient, settings: Settings, safe: str, obligations: list[Obligation],
             last_trigger_at: dict | None = None, state: TreasuryState | None = None) -> Snapshot:
    state = state or load_state(chain, settings, safe)
    reserve = required_reserve(obligations, state.timestamp, settings.params)
    risk = assess(state, settings.params, last_trigger_at)
    plan = build_plan(state, risk, reserve, settings.params)
    return Snapshot(state, obligations, reserve, risk, plan)


@dataclass
class Prepared:
    ok: bool
    stage: str
    validation: Validation | None = None
    policy: PolicyResult | None = None
    simulation: simulator.Simulation | None = None
    dar: DAR | None = None
    approval: Approval | None = None
    evidence: dict = field(default_factory=dict)
    error: str | None = None

    @property
    def is_hold(self) -> bool:
        return self.validation is not None and self.validation.is_hold

    def to_json(self) -> dict:
        return {
            "ok": self.ok, "stage": self.stage, "error": self.error,
            "validation": self.validation.to_json() if self.validation else None,
            "policy": self.policy.to_json() if self.policy else None,
            "simulation": self.simulation.to_json() if self.simulation else None,
            "dar": self.dar.to_json() if self.dar else None,
            "approval": self.approval.to_json() if self.approval else None,
            "evidence": self.evidence,
        }


def approval_fits(approval: Approval, dar: DAR, state: TreasuryState, approved_tier: int, tier: int) -> str | None:
    """Returns why a freshly rebuilt action no longer fits inside the human Approval, or None if it fits."""
    if (approval.safe.lower(), approval.op, approval.vault.lower()) != (dar.safe.lower(), dar.op, dar.vault.lower()):
        return "ApprovalMismatch"
    if dar.amount > approval.maxAmount:
        return "ApprovalExceeded"
    if approval.policyVersion != state.policy.policy_version:
        return "PolicyVersionMismatch"
    if state.timestamp >= approval.approvalExpiry:
        return "ApprovalExpired"
    if tier > approved_tier:
        return "TierRaised"
    return None


def prepare(chain: ChainClient, settings: Settings, snap: Snapshot, option_id: str, reductions: dict | None,
            request_id: str, authorizer: str | None, approval: Approval | None = None) -> Prepared:
    params = settings.params
    validation = validate(snap.plan, option_id, reductions)
    if not validation.ok:
        return Prepared(False, "validation", validation, error=validation.error)
    if validation.is_hold:
        return Prepared(True, "hold", validation)
    opt = validation.option
    op, vault = opt.op, opt.vault
    chain_tier = chain.module_required_tier(snap.state.safe, vault, validation.assets) if op == OP_DEPOSIT else None
    policy = verify(snap.state, snap.reserve.required, op, vault, validation.assets, validation.shares, params,
                    validation.escalate_tier, authorizer, chain_tier)
    if not policy.ok:
        return Prepared(False, "policy", validation, policy, error=policy.reject_reason)
    leg_amount = validation.assets if op == OP_DEPOSIT else validation.shares
    out = simulator.expected_out(chain, op, vault, leg_amount, snap.state.safe)
    if not out.ok:
        sim = simulator.Simulation(False, out.error, policy.tier, 0, "vault")
        return Prepared(False, "simulation", validation, policy, sim, error=out.error)
    if policy.tier >= 3 and approval is None:
        approval = build_approval(snap.state, op, vault, validation.assets, snap.state.timestamp, params)
    if policy.tier < 3:
        approval = None
    evidence = {
        "requestId": request_id,
        "planHash": snap.plan.plan_hash,
        "optionId": option_id,
        "reductions": reductions or {},
        "defaultOptionId": snap.plan.default_id,
        "scheduleHash": snap.reserve.schedule_hash,
        "requiredReserve": str(snap.reserve.required),
        "versions": snap.state.versions(),
        "tier": policy.tier,
    }
    ev_hash = evidence_hash(evidence)
    try:
        dar = build_dar(snap.state, op, vault, leg_amount, out.value, policy.tier, approval, ev_hash,
                        snap.state.timestamp, params)
    except ValueError as e:
        return Prepared(False, "policy", validation, policy, error=str(e))
    evidence["evidenceHash"] = hex32(ev_hash)
    sim = simulator.check(chain, dar, approval, out.value)
    if not sim.ok:
        return Prepared(False, "simulation", validation, policy, sim, dar, approval, evidence, sim.error)
    return Prepared(True, "simulated", validation, policy, sim, dar, approval, evidence)
