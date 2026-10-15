"""Allocation Planner: deterministic plan options with one default (TECHNICAL-DOCUMENT 03, algorithms 2 and 4)."""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field

from eth_utils import keccak

from aegis.config import Params
from aegis.core.reserve import ReserveResult, deployable, floor_in_sync
from aegis.core.risk import PEG, STALE, RiskReport
from aegis.core.state import TreasuryState, VaultState
from aegis.eip712 import OP_DEPOSIT, OP_NAMES, OP_REDEEM
from aegis.units import amount

HOLD_ID = "hold"
CENT = 10_000


@dataclass
class PlanOption:
    id: str
    label: str
    op: int | None
    vault: str | None
    vault_label: str | None
    assets: int
    shares: int
    exposure: dict[str, int]
    is_default: bool = False
    reason: str = ""

    @property
    def is_hold(self) -> bool:
        return self.op is None

    def to_json(self) -> dict:
        return {
            "id": self.id,
            "label": self.label,
            "op": OP_NAMES.get(self.op, "HOLD") if self.op is not None else "HOLD",
            "vault": {"address": self.vault, "name": self.vault_label} if self.vault else None,
            "amount": amount(self.assets),
            "shares": str(self.shares) if self.op == OP_REDEEM else None,
            "exposure": {k: str(v) for k, v in self.exposure.items()},
            "isDefault": self.is_default,
            "reason": self.reason,
        }


@dataclass
class Plan:
    safe: str
    timestamp: int
    versions: dict
    required: int
    onchain_floor: int
    in_sync: bool
    deployable: int
    depositable: int
    targets: dict[str, int]
    options: list[PlanOption]
    default_id: str
    hold_reason: str | None
    schedule_hash: str
    plan_hash: str = ""
    notes: list[str] = field(default_factory=list)

    def option(self, option_id: str) -> PlanOption | None:
        return next((o for o in self.options if o.id == option_id), None)

    @property
    def default(self) -> PlanOption:
        return self.option(self.default_id)

    def to_json(self) -> dict:
        return {
            "planHash": self.plan_hash,
            "safe": self.safe,
            "reserve": {"required": amount(self.required), "onchainFloor": amount(self.onchain_floor),
                        "inSync": self.in_sync, "scheduleHash": self.schedule_hash},
            "deployable": amount(self.deployable),
            "depositable": amount(self.depositable),
            "targets": {k: amount(v) for k, v in self.targets.items()},
            "options": [o.to_json() for o in self.options],
            "defaultOptionId": self.default_id,
            "holdReason": self.hold_reason,
            "notes": self.notes,
            "versions": self.versions,
        }

    def to_record(self) -> dict:
        d = asdict(self)
        d["options"] = [asdict(o) for o in self.options]
        return d

    @classmethod
    def from_record(cls, d: dict) -> "Plan":
        d = dict(d)
        d["options"] = [PlanOption(**o) for o in d["options"]]
        return cls(**d)


def _slug(label: str) -> str:
    return "".join(c if c.isalnum() else "-" for c in label.lower()).strip("-")


def net_yield(v: VaultState, risk_score: float, params: Params) -> float:
    return v.apy - v.cost - params.risk_lambda * risk_score


def _redeem_shares(v: VaultState, assets: int, full: bool) -> int:
    if full or assets >= v.assets:
        shares = v.shares
    else:
        shares = -(-assets * v.shares // v.assets) if v.assets else 0
    return min(shares, v.shares, v.max_redeem_shares)


def _assets_for_shares(v: VaultState, shares: int) -> int:
    return shares * v.assets // v.shares if v.shares else 0


def build_plan(state: TreasuryState, risk: RiskReport, reserve: ReserveResult, params: Params) -> Plan:
    policy = state.policy
    floor = policy.reserve_floor
    in_sync = floor_in_sync(floor, reserve.required)
    d = deployable(state.liquid, reserve.required, params.fee_reserve)
    keep = max(reserve.required, floor) + params.fee_reserve
    depositable = max(0, state.safe_usdc - keep)
    if policy.daily_cap:
        depositable = min(depositable, max(0, policy.daily_cap - state.deposited_today))
    notes: list[str] = []

    def finish(options: list[PlanOption], default_id: str, hold_reason: str | None, targets: dict) -> Plan:
        for o in options:
            o.is_default = o.id == default_id
        plan = Plan(
            safe=state.safe, timestamp=state.timestamp, versions=state.versions(), required=reserve.required,
            onchain_floor=floor, in_sync=in_sync, deployable=d, depositable=depositable, targets=targets,
            options=options, default_id=default_id, hold_reason=hold_reason, schedule_hash=reserve.schedule_hash,
            notes=notes,
        )
        core = {k: v for k, v in plan.to_record().items() if k not in ("plan_hash", "versions", "timestamp")}
        plan.plan_hash = "0x" + keccak(text=json.dumps(core, sort_keys=True, default=str)).hex()
        return plan

    hold = PlanOption(HOLD_ID, "Hold: no action", None, None, None, 0, 0, {}, reason="")

    if not in_sync:
        hold.reason = "FloorOutOfSync"
        notes.append("On-chain reserve floor is below the required reserve; owner must sign setReserveFloor.")
        return finish([hold], HOLD_ID, "FloorOutOfSync", {})

    codes = {t.code for vr in risk.vaults for t in vr.triggers}
    deposits_blocked = None
    if policy.owner_frozen or policy.bank_frozen:
        deposits_blocked = "Frozen"
    elif STALE in codes:
        deposits_blocked = "StaleOracle"
    elif PEG in codes:
        deposits_blocked = "PegDeviation"

    eligible = [v for v in state.vaults
                if v.allowed and not v.quarantined and not risk.vault(v.address).triggered]
    ranked = sorted(eligible, key=lambda v: (-net_yield(v, risk.vault(v.address).score, params), v.address.lower()))
    ranked = [v for v in ranked if net_yield(v, risk.vault(v.address).score, params) > 0]

    cap = d * params.per_vault_cap_bps // 10_000
    remaining = d
    targets: dict[str, int] = {}
    for v in ranked:
        t = min(cap, remaining)
        targets[v.address] = t
        remaining -= t
    if deposits_blocked:
        for v in eligible:
            targets[v.address] = min(targets.get(v.address, 0), v.assets) if v.address in targets else v.assets

    redeem_legs: list[PlanOption] = []
    protective: dict[str, bool] = {}
    deposit_legs: list[PlanOption] = []
    for v in state.vaults:
        t = targets.get(v.address, 0)
        delta = t - v.assets
        band = t * params.hysteresis_bps // 10_000
        slug = _slug(v.label)
        if delta < 0 and -delta > band and v.shares and v.ever_deposited:
            full = t == 0
            if -delta < params.min_trade and not full:
                continue
            shares = _redeem_shares(v, -delta, full)
            if shares == 0:
                notes.append(f"{v.label}: redemption wanted but vault liquidity is zero")
                continue
            vr = risk.vault(v.address)
            why = ", ".join(tr.code for tr in vr.triggers) if vr.triggered else (
                "quarantined" if v.quarantined else ("not allowed" if not v.allowed else "above target"))
            protective[f"redeem-{slug}"] = vr.triggered or v.quarantined or not v.allowed
            redeem_legs.append(PlanOption(
                f"redeem-{slug}", f"Redeem from {v.label} back to the treasury", OP_REDEEM, v.address, v.label,
                _assets_for_shares(v, shares), shares, {v.address: -_assets_for_shares(v, shares)},
                reason=why,
            ))
        elif delta > 0 and delta > band and not deposits_blocked:
            amt = min(delta, depositable) // CENT * CENT
            if amt >= params.min_trade:
                deposit_legs.append(PlanOption(
                    f"deposit-{slug}", f"Deposit surplus into {v.label}", OP_DEPOSIT, v.address, v.label,
                    amt, 0, {v.address: amt},
                    reason=f"target {amount(t)['display']} USDC, current {amount(v.assets)['display']} USDC",
                ))

    redeem_legs.sort(key=lambda o: (0 if protective[o.id] else 1, -o.assets, o.id))
    rank = {v.address: i for i, v in enumerate(ranked)}
    deposit_legs.sort(key=lambda o: (rank.get(o.vault, 99), o.id))
    legs = redeem_legs + deposit_legs

    options: list[PlanOption] = list(legs)
    if legs:
        top = legs[0]
        if top.op == OP_DEPOSIT:
            if policy.auto_cap and params.min_trade <= policy.auto_cap < top.assets:
                a = policy.auto_cap // CENT * CENT
                options.append(PlanOption(f"{top.id}-routine", f"Deposit {amount(a)['display']} (autoCap) into "
                                          f"{top.vault_label}", OP_DEPOSIT, top.vault, top.vault_label, a, 0,
                                          {top.vault: a}, reason="sized at autoCap"))
            half = top.assets // 2 // CENT * CENT
            if half >= params.min_trade:
                options.append(PlanOption(f"{top.id}-half", f"Deposit half into {top.vault_label}", OP_DEPOSIT,
                                          top.vault, top.vault_label, half, 0, {top.vault: half},
                                          reason="more conservative than default"))
        else:
            v = state.vault(top.vault)
            hs = top.shares // 2
            if hs and v:
                ha = _assets_for_shares(v, hs)
                options.append(PlanOption(f"{top.id}-half", f"Redeem half from {top.vault_label}", OP_REDEEM,
                                          top.vault, top.vault_label, ha, hs, {top.vault: -ha},
                                          reason="partial redemption"))
    leg_vaults_redeem = {o.vault for o in redeem_legs}
    for v in state.vaults:
        if v.shares and v.ever_deposited and v.address not in leg_vaults_redeem:
            shares = min(v.shares, v.max_redeem_shares)
            if shares:
                a = _assets_for_shares(v, shares)
                options.append(PlanOption(f"redeem-{_slug(v.label)}-all", f"Redeem all from {v.label}", OP_REDEEM,
                                          v.address, v.label, a, shares, {v.address: -a},
                                          reason="owner-requested exit"))
    options.append(hold)

    if legs:
        default_id, hold_reason = legs[0].id, None
    else:
        if deposits_blocked:
            hold_reason = deposits_blocked
        elif d == 0 or depositable < params.min_trade:
            hold_reason = "NothingDeployable"
        else:
            hold_reason = "WithinBand"
        hold.reason = hold_reason
        default_id = HOLD_ID
    if deposits_blocked:
        notes.append(f"Deposits blocked: {deposits_blocked}")
    return finish(options, default_id, hold_reason, targets)
