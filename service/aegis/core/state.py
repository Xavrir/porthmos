"""State Analyzer: the only reader of chain state for the deterministic core."""

from __future__ import annotations

from dataclasses import dataclass, field

from aegis.chain.base import ChainClient, PolicyState, Round
from aegis.config import Settings
from aegis.units import amount


@dataclass
class VaultState:
    address: str
    label: str
    metadata_name: str
    apy: float
    cost: float
    shares: int
    assets: int
    max_redeem_shares: int
    withdrawable_assets: int
    total_assets: int
    idle: int
    remaining_liquidity: int | None
    allowed: bool
    quarantined: bool
    quarantined_at: int
    ever_deposited: bool

    @property
    def vault_liquidity(self) -> int:
        """Assets the vault can release to all holders right now."""
        if self.remaining_liquidity is None:
            return self.idle
        return min(self.idle, self.remaining_liquidity)


@dataclass
class TreasuryState:
    safe: str
    block: int
    timestamp: int
    safe_usdc: int
    vaults: list[VaultState]
    oracle: Round
    policy: PolicyState
    deposited_today: int
    vault_index: dict[str, VaultState] = field(default_factory=dict)

    def __post_init__(self):
        self.vault_index = {v.address.lower(): v for v in self.vaults}

    def vault(self, address: str) -> VaultState | None:
        return self.vault_index.get(address.lower())

    @property
    def oracle_age(self) -> int:
        return max(0, self.timestamp - self.oracle.updated_at)

    @property
    def total_value(self) -> int:
        return self.safe_usdc + sum(v.assets for v in self.vaults)

    @property
    def liquid(self) -> int:
        return self.safe_usdc + sum(v.withdrawable_assets for v in self.vaults)

    def versions(self) -> dict:
        return {
            "block": self.block,
            "timestamp": self.timestamp,
            "policyVersion": self.policy.policy_version,
            "oracleRound": self.oracle.round_id,
            "oracleUpdatedAt": self.oracle.updated_at,
            "onchainScheduleHash": self.policy.schedule_hash,
        }

    def to_json(self) -> dict:
        return {
            "safe": self.safe,
            "block": self.block,
            "timestamp": self.timestamp,
            "safeUsdc": amount(self.safe_usdc),
            "vaults": [
                {
                    "address": v.address, "name": v.label, "shares": str(v.shares), "assets": amount(v.assets),
                    "withdrawable": amount(v.withdrawable_assets), "allowed": v.allowed,
                    "quarantined": v.quarantined, "everDeposited": v.ever_deposited,
                }
                for v in self.vaults
            ],
            "oracle": {"price": str(self.oracle.answer), "updatedAt": self.oracle.updated_at,
                       "ageSeconds": self.oracle_age},
            "depositedToday": amount(self.deposited_today),
        }


def load_state(chain: ChainClient, settings: Settings, safe: str) -> TreasuryState:
    vault_addrs = [v.address for v in settings.addresses.vaults]
    block = chain.block_number()
    ts = chain.block_timestamp()
    policy = chain.policy(safe, vault_addrs)
    vaults = []
    for meta in settings.addresses.vaults:
        a = meta.address
        shares = chain.shares_of(a, safe)
        max_redeem = chain.max_redeem(a, safe) if shares else 0
        vaults.append(VaultState(
            address=a,
            label=meta.label,
            metadata_name=chain.vault_name(a),
            apy=meta.apy,
            cost=meta.cost,
            shares=shares,
            assets=chain.convert_to_assets(a, shares) if shares else 0,
            max_redeem_shares=max_redeem,
            withdrawable_assets=chain.preview_redeem(a, max_redeem) if max_redeem else 0,
            total_assets=chain.vault_total_assets(a),
            idle=chain.vault_idle(a),
            remaining_liquidity=chain.remaining_liquidity(a),
            allowed=policy.is_allowed(a),
            quarantined=policy.is_quarantined(a),
            quarantined_at=policy.quarantined_at.get(a.lower(), 0),
            ever_deposited=chain.ever_deposited(safe, a),
        ))
    return TreasuryState(
        safe=safe,
        block=block,
        timestamp=ts,
        safe_usdc=chain.usdc_balance(safe),
        vaults=vaults,
        oracle=chain.latest_round(),
        policy=policy,
        deposited_today=chain.deposited_today(safe),
    )
