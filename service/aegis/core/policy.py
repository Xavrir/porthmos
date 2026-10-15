"""Policy Verifier: client and bank policy checks, and the tier the module will require (INTERFACES 1.5)."""

from __future__ import annotations

from dataclasses import dataclass, field

from aegis.config import PRICE_ONE, Params
from aegis.core.risk import max_oracle_age
from aegis.core.state import TreasuryState
from aegis.eip712 import OP_DEPOSIT, OP_REDEEM
from aegis.units import amount

T1, T2, T3, T4 = 1, 2, 3, 4
SIGNERS = {
    T1: ["authorizer"],
    T2: ["authorizer"],
    T3: ["authorizer", "owner"],
    T4: ["authorizer", "owner", "bank"],
}


def derive_tier(op: int, amount_assets: int, auto_cap: int, bank_limit: int, ever_deposited: bool) -> int:
    """Mirror of AegisModule.requiredTier: T4 above bankLimit (0 = no bank requirement), else T3 above
    autoCap or on a first deposit into the vault, else T2. Every REDEEM is T1."""
    if op == OP_REDEEM:
        return T1
    if bank_limit != 0 and amount_assets > bank_limit:
        return T4
    if amount_assets > auto_cap or not ever_deposited:
        return T3
    return T2


@dataclass
class PolicyCheck:
    name: str
    ok: bool
    detail: str

    def to_json(self) -> dict:
        return {"name": self.name, "ok": self.ok, "detail": self.detail}


@dataclass
class PolicyResult:
    ok: bool
    tier: int
    required_signers: list[str]
    checks: list[PolicyCheck] = field(default_factory=list)

    @property
    def reject_reason(self) -> str | None:
        failed = [c.name for c in self.checks if not c.ok]
        return failed[0] if failed else None

    def to_json(self) -> dict:
        return {"ok": self.ok, "tier": self.tier, "requiredSigners": self.required_signers,
                "checks": [c.to_json() for c in self.checks], "rejectReason": self.reject_reason}


def verify(state: TreasuryState, required_reserve: int, op: int, vault: str, assets: int, shares: int,
           params: Params, escalate_tier: int = 0, authorizer: str | None = None,
           chain_required_tier: int | None = None) -> PolicyResult:
    p = state.policy
    v = state.vault(vault)
    checks: list[PolicyCheck] = []

    def add(name: str, ok: bool, detail: str):
        checks.append(PolicyCheck(name, bool(ok), detail))

    if v is None:
        add("knownVault", False, "vault is not configured for this service")
        return PolicyResult(False, 0, [], checks)

    if op == OP_REDEEM:
        tier = T1
        add("amountPositive", shares > 0, f"{shares} shares")
        add("positionHeld", 0 < shares <= v.shares, f"Safe holds {v.shares} shares")
        add("everDeposited", v.ever_deposited, "the module redeems only from vaults it deposited into")
        add("vaultLiquidity", shares <= v.max_redeem_shares, f"maxRedeem {v.max_redeem_shares} shares")
        if authorizer:
            add("authorizerRegistered", p.authorizer.lower() == authorizer.lower(),
                "registry authorizer matches this service's Authorizer")
        return PolicyResult(all(c.ok for c in checks), tier, SIGNERS[tier], checks)

    if op != OP_DEPOSIT:
        add("op", False, "unknown op")
        return PolicyResult(False, 0, [], checks)

    tier = derive_tier(op, assets, p.auto_cap, p.bank_limit, v.ever_deposited)
    if chain_required_tier is not None:
        add("tierAgreesWithModule", chain_required_tier <= max(tier, escalate_tier),
            f"service T{tier}, module T{chain_required_tier}")
        tier = max(tier, chain_required_tier)
    tier = max(tier, escalate_tier)
    floor = p.reserve_floor
    after = state.safe_usdc - assets
    age = state.oracle_age
    limit = max_oracle_age(state, params)
    deviation = abs(state.oracle.answer - PRICE_ONE)
    band = min(params.band_width, p.max_band_width) if p.max_band_width else 0

    add("amountPositive", assets > 0, amount(assets)["display"] + " USDC")
    add("notFrozen", not (p.owner_frozen or p.bank_frozen),
        f"ownerFrozen={p.owner_frozen} bankFrozen={p.bank_frozen}")
    add("vaultAllowed", v.allowed, "vault added by the owner" if v.allowed else "vault not in the allowlist")
    add("vaultNotQuarantined", not v.quarantined, "quarantined" if v.quarantined else "not quarantined")
    add("oracleFresh", age <= limit, f"age {age}s, maxOracleAge {limit}s")
    add("pegWithinThreshold", deviation <= params.peg_threshold,
        f"price {state.oracle.answer / PRICE_ONE:.4f}")
    add("bandWidth", 0 < band <= p.max_band_width, f"band {band} <= maxBandWidth {p.max_band_width}")
    add("reserveFloor", after >= floor,
        f"Safe USDC after {amount(max(after, 0))['display']} >= on-chain floor {amount(floor)['display']}")
    add("requiredReserve", after >= required_reserve + params.fee_reserve,
        f"Safe USDC after {amount(max(after, 0))['display']} >= required reserve "
        f"{amount(required_reserve + params.fee_reserve)['display']}")
    add("dailyCap", state.deposited_today + assets <= p.daily_cap,
        f"today {amount(state.deposited_today)['display']} + {amount(assets)['display']} <= "
        f"{amount(p.daily_cap)['display']}")
    if tier == T4:
        add("bankConfigured", int(p.bank, 16) != 0, "bank approval required above bankLimit")
    if authorizer:
        add("authorizerRegistered", p.authorizer.lower() == authorizer.lower(),
            "registry authorizer matches this service's Authorizer")
    return PolicyResult(all(c.ok for c in checks), tier, SIGNERS[tier], checks)
