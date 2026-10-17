from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field

from aegis.eip712 import DAR, Approval
from aegis.tradeflow.typed import MilestoneProof, MilestoneTerms, Order, ReleaseAuthorization


@dataclass
class Round:
    round_id: int
    answer: int
    updated_at: int


@dataclass
class PolicyState:
    safe: str
    owner: str
    bank: str
    authorizer: str
    exit_key: str
    auto_cap: int
    daily_cap: int
    bank_limit: int
    reserve_floor: int
    schedule_hash: str
    max_band_width: int
    max_oracle_age: int
    owner_frozen: bool
    bank_frozen: bool
    policy_version: int
    allowed: dict[str, bool] = field(default_factory=dict)
    quarantined: dict[str, bool] = field(default_factory=dict)
    quarantined_at: dict[str, int] = field(default_factory=dict)

    def is_allowed(self, vault: str) -> bool:
        return self.allowed.get(vault.lower(), False)

    def is_quarantined(self, vault: str) -> bool:
        return self.quarantined.get(vault.lower(), False)


@dataclass
class CheckResult:
    ok: bool
    error: str | None
    required_tier: int


@dataclass
class SimResult:
    ok: bool
    error: str | None = None
    value: int = 0


@dataclass
class Receipt:
    tx_hash: str
    status: int
    block_number: int
    executed: list[dict] = field(default_factory=list)
    revert_reason: str | None = None


class ChainClient(ABC):
    chain_id: int

    @abstractmethod
    def block_number(self) -> int: ...

    @abstractmethod
    def block_timestamp(self) -> int: ...

    @abstractmethod
    def usdc_balance(self, who: str) -> int: ...

    @abstractmethod
    def vault_name(self, vault: str) -> str: ...

    @abstractmethod
    def vault_total_assets(self, vault: str) -> int: ...

    @abstractmethod
    def vault_idle(self, vault: str) -> int: ...

    @abstractmethod
    def remaining_liquidity(self, vault: str) -> int | None: ...

    @abstractmethod
    def shares_of(self, vault: str, who: str) -> int: ...

    @abstractmethod
    def convert_to_assets(self, vault: str, shares: int) -> int: ...

    @abstractmethod
    def preview_deposit(self, vault: str, assets: int) -> int: ...

    @abstractmethod
    def preview_redeem(self, vault: str, shares: int) -> int: ...

    @abstractmethod
    def preview_withdraw(self, vault: str, assets: int) -> int: ...

    @abstractmethod
    def max_redeem(self, vault: str, owner: str) -> int: ...

    @abstractmethod
    def latest_round(self) -> Round: ...

    @abstractmethod
    def policy(self, safe: str, vaults: list[str]) -> PolicyState: ...

    @abstractmethod
    def ever_deposited(self, safe: str, vault: str) -> bool: ...

    @abstractmethod
    def deposited_today(self, safe: str) -> int: ...

    @abstractmethod
    def used_nonce(self, safe: str, nonce: int) -> bool: ...

    @abstractmethod
    def module_required_tier(self, safe: str, vault: str, amount: int) -> int: ...

    @abstractmethod
    def module_check(self, dar: DAR, approval: Approval) -> CheckResult: ...

    @abstractmethod
    def sim_vault_redeem(self, vault: str, shares: int, safe: str) -> SimResult:
        """eth_call of vault.redeem(shares, safe, safe) from the Safe address."""

    @abstractmethod
    def sim_deposit_submission(self, dar: DAR, auth_sig: str, owner_sig: str, bank_sig: str,
                               approval: Approval, sender: str) -> SimResult: ...

    @abstractmethod
    def sim_redeem_submission(self, dar: DAR, sig: str, sender: str) -> SimResult: ...

    @abstractmethod
    def submit_deposit(self, key: str, dar: DAR, auth_sig: str, owner_sig: str, bank_sig: str,
                       approval: Approval, gas: int | None = None) -> str: ...

    @abstractmethod
    def submit_redeem(self, key: str, dar: DAR, sig: str, gas: int | None = None) -> str: ...

    @abstractmethod
    def receipt(self, tx_hash: str) -> Receipt | None: ...

    @abstractmethod
    def quarantine(self, key: str, safe: str, vault: str) -> str: ...

    @abstractmethod
    def poke(self, key: str) -> str: ...

    @abstractmethod
    def events(self, safe: str | None = None, from_block: int = 0) -> list[dict]: ...

    @abstractmethod
    def encode_set_reserve_floor(self, safe: str, floor: int, schedule_hash: str) -> dict: ...

    @abstractmethod
    def admin_set_price(self, key: str, answer: int) -> str: ...

    @abstractmethod
    def admin_set_liquidity_cap(self, key: str, vault: str, assets: int) -> str: ...

    @abstractmethod
    def admin_increase_time(self, seconds: int) -> None: ...

    @abstractmethod
    def head_timestamp(self) -> int:
        """Timestamp of the latest mined block, without the Anvil wall-clock adjustment."""

    @abstractmethod
    def eth_balance(self, who: str) -> int: ...

    @abstractmethod
    def code_size(self, who: str) -> int: ...

    @abstractmethod
    def send_value(self, key: str, to: str, value: int) -> str: ...

    @abstractmethod
    def mint_usdc(self, key: str, to: str, amount: int) -> str: ...

    @abstractmethod
    def predict_safe(self, owner: str) -> str: ...

    @abstractmethod
    def safe_threshold(self, safe: str) -> int: ...

    @abstractmethod
    def safe_owners(self, safe: str) -> list[str]: ...

    @abstractmethod
    def safe_module_enabled(self, safe: str, module: str) -> bool: ...

    @abstractmethod
    def wait_receipt(self, tx_hash: str, timeout: float = 30.0) -> Receipt | None: ...

    @abstractmethod
    def escrow_order(self, order_id: int) -> Order:
        """TradeEscrow.getOrder; an unknown id has status NONE."""

    @abstractmethod
    def escrow_milestones(self, order_id: int) -> list[tuple[MilestoneTerms, int]]:
        """TradeEscrow.getMilestone for indexes 0 to 2: (terms, on-chain status)."""

    @abstractmethod
    def escrow_committed_of(self, safe: str) -> int: ...

    @abstractmethod
    def escrow_used_nonce(self, buyer: str, nonce: int) -> bool: ...

    @abstractmethod
    def escrow_check_release(self, order_id: int, index: int, proof: MilestoneProof,
                             auth: ReleaseAuthorization) -> SimResult:
        """TradeEscrow.checkRelease: every release check except the two signatures; error is the selector name."""

    @abstractmethod
    def sim_release(self, order_id: int, index: int, proof: MilestoneProof, issuer_sig: str,
                    auth: ReleaseAuthorization, auth_sig: str, sender: str) -> SimResult:
        """Final signed eth_call of release()."""

    @abstractmethod
    def submit_release(self, key: str, order_id: int, index: int, proof: MilestoneProof, issuer_sig: str,
                       auth: ReleaseAuthorization, auth_sig: str, gas: int | None = None) -> str: ...

    @abstractmethod
    def escrow_events(self, from_block: int, to_block: int) -> list[dict]:
        """OrderCreated, MilestoneReleased and OrderRefunded in [from_block, to_block], in log order."""

    def erc1271_valid(self, account: str, digest: bytes, signature: bytes) -> bool:
        """ERC-1271 isValidSignature(digest, signature) on a deployed contract account returns the magic value."""
        return False

    def erc6492_valid(self, account: str, digest: bytes, signature: bytes) -> bool:
        """ERC-6492: the deployless universal validator accepts a signature from a wallet not deployed yet."""
        return False

    def address_of(self, key: str) -> str:
        from eth_account import Account

        return Account.from_key(key).address
