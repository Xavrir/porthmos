"""Proposal Validator: the "only more conservative" rule against the default option (TECHNICAL-DOCUMENT 03)."""

from __future__ import annotations

from dataclasses import dataclass, field

from aegis.core.planner import Plan, PlanOption
from aegis.eip712 import OP_REDEEM

TIER_MATERIAL = 3


@dataclass
class Validation:
    ok: bool
    option: PlanOption | None
    assets: int = 0
    shares: int = 0
    escalate_tier: int = 0
    reasons: list[str] = field(default_factory=list)
    error: str | None = None

    @property
    def is_hold(self) -> bool:
        return self.ok and self.option is not None and self.option.is_hold

    def to_json(self) -> dict:
        return {
            "ok": self.ok,
            "optionId": self.option.id if self.option else None,
            "assets": str(self.assets),
            "shares": str(self.shares),
            "escalateTier": self.escalate_tier or None,
            "reasons": self.reasons,
            "error": self.error,
        }


def apply_reductions(option: PlanOption, reductions: dict | None) -> tuple[int, int]:
    """Reductions can only lower the option. Returns (assets, shares)."""
    assets, shares = option.assets, option.shares
    if not reductions:
        return assets, shares
    raw = reductions.get("amount")
    if raw is None:
        return assets, shares
    new = int(raw.get("raw") if isinstance(raw, dict) else raw)
    if new <= 0:
        raise ValueError("reduced amount must be positive")
    if new > assets:
        raise ValueError("reductions may only lower the option amount")
    if option.op == OP_REDEEM:
        shares = min(option.shares, -(-new * option.shares // option.assets)) if option.assets else 0
    return new, shares


def validate(plan: Plan, option_id: str, reductions: dict | None = None) -> Validation:
    option = plan.option(option_id)
    if option is None:
        return Validation(False, None, error=f"unknown option {option_id!r}; the agent may only pick plan options")
    if option.is_hold:
        return Validation(True, option, reasons=["hold"])
    try:
        assets, shares = apply_reductions(option, reductions)
    except (ValueError, TypeError) as e:
        return Validation(False, option, error=str(e))
    sign = -1 if option.op == OP_REDEEM else 1
    chosen = {option.vault.lower(): sign * assets}
    default = {k.lower(): v for k, v in plan.default.exposure.items()}
    above = [v for v, x in chosen.items() if x > default.get(v, 0)]
    result = Validation(True, option, assets, shares)
    if above:
        result.escalate_tier = TIER_MATERIAL
        result.reasons.append("AboveDefault: exposure exceeds the default option in "
                              + ", ".join(above) + "; owner approval required (T3)")
    else:
        result.reasons.append("AtOrBelowDefault")
    return result
