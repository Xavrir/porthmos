"""State Analyzer: the only reader of chain state for the deterministic core."""

from __future__ import annotations

import functools
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
    block, ts = chain.block_header()
    chain = chain.at_block(block)
    policy, safe_usdc, oracle, deposited_today, *reads = chain.gather([
        lambda: chain.policy(safe, vault_addrs),
        lambda: chain.usdc_balance(safe),
        chain.latest_round,
        lambda: chain.deposited_today(safe),
        *(functools.partial(_vault_reads, chain, a, safe) for a in vault_addrs),
    ])
    vaults = []
    for meta, (shares, name, total_assets, idle, remaining, ever, assets, max_redeem, withdrawable) in zip(
            settings.addresses.vaults, reads):
        a = meta.address
        vaults.append(VaultState(
            address=a,
            label=meta.label,
            metadata_name=name,
            apy=meta.apy,
            cost=meta.cost,
            shares=shares,
            assets=assets,
            max_redeem_shares=max_redeem,
            withdrawable_assets=withdrawable,
            total_assets=total_assets,
            idle=idle,
            remaining_liquidity=remaining,
            allowed=policy.is_allowed(a),
            quarantined=policy.is_quarantined(a),
            quarantined_at=policy.quarantined_at.get(a.lower(), 0),
            ever_deposited=ever,
        ))
    return TreasuryState(
        safe=safe,
        block=block,
        timestamp=ts,
        safe_usdc=safe_usdc,
        vaults=vaults,
        oracle=oracle,
        policy=policy,
        deposited_today=deposited_today,
    )


def _vault_reads(chain: ChainClient, a: str, safe: str) -> tuple:
    def speculative_max_redeem():
        try:
            return chain.max_redeem(a, safe), None
        except Exception as e:
            return 0, e

    shares, name, total_assets, idle, remaining, ever, (max_redeem, max_redeem_error) = chain.gather([
        lambda: chain.shares_of(a, safe),
        lambda: chain.vault_name(a),
        lambda: chain.vault_total_assets(a),
        lambda: chain.vault_idle(a),
        lambda: chain.remaining_liquidity(a),
        lambda: chain.ever_deposited(safe, a),
        speculative_max_redeem,
    ])
    if not shares:
        return shares, name, total_assets, idle, remaining, ever, 0, 0, 0
    if max_redeem_error is not None:
        raise max_redeem_error
    assets, withdrawable = chain.gather([
        lambda: chain.convert_to_assets(a, shares),
        lambda: chain.preview_redeem(a, max_redeem) if max_redeem else 0,
    ])
    return shares, name, total_assets, idle, remaining, ever, assets, max_redeem, withdrawable
