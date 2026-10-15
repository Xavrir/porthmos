"""Risk Engine: hard exit triggers, ranking score and quarantine cooldown (TECHNICAL-DOCUMENT 03, algorithm 3)."""

from __future__ import annotations

from dataclasses import dataclass, field

from aegis.config import PRICE_ONE, Params
from aegis.core.state import TreasuryState, VaultState
from aegis.units import amount

PEG = "PegDeviation"
STALE = "StaleOracle"
LIQUIDITY = "LowLiquidity"


@dataclass
class Trigger:
    code: str
    detail: str

    def to_json(self) -> dict:
        return {"code": self.code, "detail": self.detail}


@dataclass
class VaultRisk:
    address: str
    label: str
    score: float
    components: dict[str, float]
    triggers: list[Trigger]
    quarantined: bool
    quarantined_at: int
    max_redeem: int
    position_shares: int
    position_assets: int
    vault_liquidity: int
    cooldown_ends_at: int | None = None
    clearable: bool = False

    @property
    def triggered(self) -> bool:
        return bool(self.triggers)

    def to_json(self) -> dict:
        return {
            "address": self.address,
            "name": self.label,
            "score": round(self.score, 4),
            "components": {k: round(v, 4) for k, v in self.components.items()},
            "triggers": [t.to_json() for t in self.triggers],
            "quarantined": self.quarantined,
            "quarantinedAt": self.quarantined_at or None,
            "cooldownEndsAt": self.cooldown_ends_at,
            "clearable": self.clearable,
            "maxRedeem": str(self.max_redeem),
            "position": {"shares": str(self.position_shares), "assets": amount(self.position_assets)},
            "vaultLiquidity": amount(self.vault_liquidity),
        }


@dataclass
class RiskReport:
    vaults: list[VaultRisk]
    oracle_stale: bool
    peg_deviation: int
    oracle_age: int
    max_oracle_age: int
    index: dict[str, VaultRisk] = field(default_factory=dict)

    def __post_init__(self):
        self.index = {v.address.lower(): v for v in self.vaults}

    def vault(self, address: str) -> VaultRisk | None:
        return self.index.get(address.lower())

    def to_json(self) -> dict:
        return {
            "vaults": [v.to_json() for v in self.vaults],
            "oracle": {"stale": self.oracle_stale, "ageSeconds": self.oracle_age,
                       "maxOracleAge": self.max_oracle_age, "pegDeviation": self.peg_deviation},
        }


def _clamp(x: float) -> float:
    return max(0.0, min(1.0, x))


def max_oracle_age(state: TreasuryState, params: Params) -> int:
    return state.policy.max_oracle_age or params.default_max_oracle_age


def global_triggers(state: TreasuryState, params: Params) -> list[Trigger]:
    out = []
    deviation = abs(state.oracle.answer - PRICE_ONE)
    if deviation > params.peg_threshold:
        out.append(Trigger(PEG, f"price {state.oracle.answer / PRICE_ONE:.4f} deviates "
                                f"{deviation / PRICE_ONE:.2%} from 1.00 (limit {params.peg_threshold / PRICE_ONE:.0%})"))
    limit = max_oracle_age(state, params)
    if state.oracle_age > limit:
        out.append(Trigger(STALE, f"oracle age {state.oracle_age}s exceeds maxOracleAge {limit}s"))
    return out


def liquidity_trigger(v: VaultState, params: Params) -> Trigger | None:
    """maxRedeem < 1.2 x position, measured at vault level.

    ERC-4626 maxRedeem(owner) never exceeds the owner's balance, so comparing it to our own
    position would always fire. The vault's releasable liquidity is the quantity the rule needs.
    """
    if v.shares == 0:
        return None
    needed = v.assets * params.liquidity_multiple_bps // 10_000
    if v.vault_liquidity < needed:
        return Trigger(LIQUIDITY, f"vault can release {amount(v.vault_liquidity)['display']} USDC, "
                                  f"below 1.2 x position {amount(v.assets)['display']} USDC")
    return None


def assess(state: TreasuryState, params: Params, last_trigger_at: dict[str, float] | None = None) -> RiskReport:
    last_trigger_at = last_trigger_at or {}
    common = global_triggers(state, params)
    deviation = abs(state.oracle.answer - PRICE_ONE)
    total = state.total_value or 1
    w_peg, w_liq, w_util, w_conc = params.weights
    out = []
    for v in state.vaults:
        triggers = list(common)
        lt = liquidity_trigger(v, params)
        if lt:
            triggers.append(lt)
        peg = _clamp(deviation / params.peg_threshold) if params.peg_threshold else 0.0
        ref = v.assets * params.liquidity_multiple_bps // 10_000 if v.shares else v.total_assets
        liquidity = _clamp(1 - v.vault_liquidity / ref) if ref else 0.0
        utilisation = _clamp(1 - v.idle / v.total_assets) if v.total_assets else 0.0
        concentration = _clamp(v.assets / total)
        score = w_peg * peg + w_liq * liquidity + w_util * utilisation + w_conc * concentration
        cooldown_end = None
        clearable = False
        if v.quarantined:
            anchor = max(v.quarantined_at, int(last_trigger_at.get(v.address.lower(), 0)))
            cooldown_end = anchor + params.quarantine_cooldown
            clearable = state.timestamp >= cooldown_end and not triggers
        out.append(VaultRisk(
            address=v.address, label=v.label, score=score,
            components={"peg": peg, "liquidity": liquidity, "utilisation": utilisation, "concentration": concentration},
            triggers=triggers, quarantined=v.quarantined, quarantined_at=v.quarantined_at,
            max_redeem=v.max_redeem_shares, position_shares=v.shares, position_assets=v.assets,
            vault_liquidity=v.vault_liquidity, cooldown_ends_at=cooldown_end, clearable=clearable,
        ))
    limit = max_oracle_age(state, params)
    return RiskReport(out, state.oracle_age > limit, deviation, state.oracle_age, limit)
