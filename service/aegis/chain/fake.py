"""In-memory chain that mirrors the AegisModule / PolicyRegistry rules in docs/INTERFACES.md 1.4 and 1.5.

Used by unit tests and by the offline demo (AEGIS_CHAIN=fake). It is not a trust anchor; the
Solidity contracts are. Check order follows the spec so revert names match the real module.
"""

from __future__ import annotations

import secrets
import threading
import time
from dataclasses import dataclass, field, replace

from eth_utils import to_checksum_address

from aegis.chain.base import ChainClient, CheckResult, PolicyState, Receipt, Round, SimResult
from aegis.config import ANVIL_KEYS, PRICE_ONE, UINT256_MAX, USDC, Addresses, VaultMeta, anvil_mnemonic_keys
from aegis.eip712 import (
    DAR,
    OP_DEPOSIT,
    OP_REDEEM,
    ZERO32,
    ZERO_ADDRESS,
    Approval,
    approval_digest,
    approval_struct_hash,
    dar_digest,
    hex32,
    recover_digest,
    to_bytes32,
)
from aegis.tradeflow.checks import conditions_hold
from aegis.tradeflow.typed import (
    ACTIVE,
    MilestoneProof,
    MilestoneTerms,
    Order,
    ReleaseAuthorization,
    auth_digest,
    proof_digest,
    proof_struct_hash,
)

DEMO_ISSUER_INDEX = {"carrier": 10, "sensor": 11, "surveyor": 12}
ORDER_COMPLETED, ORDER_REFUNDED = 2, 3
M_RELEASED, M_WAIVED, M_REFUNDED = 1, 2, 3


class Revert(Exception):
    def __init__(self, name: str):
        super().__init__(name)
        self.name = name


@dataclass
class FakeVault:
    address: str
    name: str
    total_assets: int = 0
    total_supply: int = 0
    balances: dict[str, int] = field(default_factory=dict)
    liquidity_cap: int = UINT256_MAX
    withdrawn_since_cap: int = 0
    deposit_reverts: bool = False
    redeem_reverts: bool = False

    def to_shares(self, assets: int, up: bool = False) -> int:
        num, den = assets * (self.total_supply + 1), self.total_assets + 1
        return -(-num // den) if up else num // den

    def to_assets(self, shares: int, up: bool = False) -> int:
        num, den = shares * (self.total_assets + 1), self.total_supply + 1
        return -(-num // den) if up else num // den

    def remaining(self) -> int:
        if self.liquidity_cap == UINT256_MAX:
            return UINT256_MAX
        return max(0, self.liquidity_cap - self.withdrawn_since_cap)

    def max_redeem(self, owner: str) -> int:
        bal = self.balances.get(owner.lower(), 0)
        rem = self.remaining()
        if rem == UINT256_MAX:
            return bal
        return min(bal, self.to_shares(rem))


@dataclass
class FakePolicy:
    owner: str
    bank: str
    authorizer: str = ZERO_ADDRESS
    exit_key: str = ZERO_ADDRESS
    auto_cap: int = 0
    daily_cap: int = 0
    bank_limit: int = 0
    reserve_floor: int = 0
    schedule_hash: bytes = ZERO32
    max_band_width: int = 0
    max_oracle_age: int = 0
    owner_frozen: bool = False
    bank_frozen: bool = False
    allowed: set[str] = field(default_factory=set)
    quarantined_at: dict[str, int] = field(default_factory=dict)
    version: int = 0


def addr_of(role: str) -> str:
    from eth_account import Account

    return Account.from_key(ANVIL_KEYS[role]).address


class FakeChain(ChainClient):
    BLOCK_TIME = 2

    def __init__(self, chain_id: int = 31337, start_time: int = 1_790_000_000):
        self.chain_id = chain_id
        self.lock = threading.RLock()
        self.now = start_time
        self.block = 1
        self.usdc: dict[str, int] = {}
        self.round_id = 1
        self.answer = PRICE_ONE
        self.updated_at = start_time
        self.vaults: dict[str, FakeVault] = {}
        self.policies: dict[str, FakePolicy] = {}
        self.ever: set[tuple[str, str]] = set()
        self.daily: dict[tuple[str, int], int] = {}
        self.used_nonces: set[tuple[str, int]] = set()
        self.receipts: dict[str, Receipt] = {}
        self.logs: list[dict] = []
        self.module_address = to_checksum_address("0x" + "a1" * 20)
        self.registry_address = to_checksum_address("0x" + "b2" * 20)
        self.usdc_address = to_checksum_address("0x" + "c3" * 20)
        self.feed_address = to_checksum_address("0x" + "d4" * 20)
        self.keeper = addr_of("keeper")
        self.admin = addr_of("admin")
        self.eth: dict[str, int] = {}
        self.safe_accounts: dict[str, dict] = {}
        self.escrow_address = to_checksum_address("0x" + "e5" * 20)
        self.multisend_address = to_checksum_address("0x" + "f6" * 20)
        self.orders: dict[int, dict] = {}
        self.next_order_id = 1
        self.committed: dict[str, int] = {}
        self.escrowed_total = 0
        self.escrow_nonces: set[tuple[str, int]] = set()
        self.escrow_logs: list[dict] = []

    def add_vault(self, address: str, name: str) -> FakeVault:
        v = FakeVault(to_checksum_address(address), name)
        self.vaults[address.lower()] = v
        return v

    def register(self, safe: str, owner: str, bank: str, **params) -> FakePolicy:
        p = FakePolicy(owner=to_checksum_address(owner), bank=to_checksum_address(bank))
        for k, v in params.items():
            setattr(p, k, v)
        self.policies[safe.lower()] = p
        self._bump(safe, "register")
        return p

    def set_policy(self, safe: str, **params) -> None:
        with self.lock:
            p = self.policies[safe.lower()]
            for k, v in params.items():
                if k == "schedule_hash":
                    v = to_bytes32(v)
                setattr(p, k, v)
            self._bump(safe, "set")

    def mint(self, who: str, amount: int) -> None:
        self.usdc[who.lower()] = self.usdc.get(who.lower(), 0) + amount

    def mine(self, n: int = 1, dt: int | None = None) -> None:
        with self.lock:
            for _ in range(n):
                self.block += 1
                self.now += self.BLOCK_TIME if dt is None else dt

    def follow_wall_clock(self) -> None:
        with self.lock:
            self.block += 1
            self.now = max(self.now + 1, int(time.time()))

    def set_price(self, answer: int) -> None:
        with self.lock:
            self.round_id += 1
            self.answer = answer
            self.updated_at = self.now

    def accrue(self, vault: str, assets: int) -> None:
        v = self.vaults[vault.lower()]
        v.total_assets += assets

    def _bump(self, safe: str, selector: str) -> None:
        p = self.policies[safe.lower()]
        p.version += 1
        self.logs.append({
            "event": "PolicyChanged", "safe": to_checksum_address(safe), "version": p.version,
            "selector": selector, "txHash": self._txhash(), "blockNumber": self.block, "logIndex": len(self.logs),
        })

    @staticmethod
    def _txhash() -> str:
        return "0x" + secrets.token_hex(32)

    @classmethod
    def demo(cls, safe_usdc: int = 10_000 * USDC, tradeflow: bool = True) -> tuple["FakeChain", Addresses]:
        """A chain shaped like deployments/31337.json params: two vaults, one registered Safe, and TradeEscrow with
        demo issuers taken from the Anvil mnemonic unless tradeflow is False."""
        chain = cls()
        safe = to_checksum_address("0x" + "5a" * 20)
        va = chain.add_vault("0x" + "a0" * 20, "Vault A")
        vb = chain.add_vault("0x" + "b0" * 20, "Vault B")
        chain.register(
            safe, addr_of("owner"), addr_of("bank"),
            authorizer=addr_of("authorizer"), exit_key=addr_of("exitKey"),
            auto_cap=1000 * USDC, daily_cap=5000 * USDC, bank_limit=3000 * USDC, reserve_floor=4500 * USDC,
            max_band_width=2_000_000, max_oracle_age=180, allowed={va.address.lower(), vb.address.lower()},
        )
        chain.mint(safe, safe_usdc)
        chain.safe_accounts[safe.lower()] = {"owners": [addr_of("owner")], "threshold": 1,
                                             "modules": {chain.module_address.lower()}}
        seed = to_checksum_address("0x" + "5e" * 20)
        for v in (va, vb):
            chain.mint(seed, 50_000 * USDC)
            chain._vault_deposit(v, seed, 50_000 * USDC)
        addresses = Addresses(
            usdc=chain.usdc_address, price_feed=chain.feed_address, registry=chain.registry_address,
            module=chain.module_address, safes=[safe],
            vaults=[VaultMeta(va.address, "Vault A", 0.045, 0.001), VaultMeta(vb.address, "Vault B", 0.060, 0.001)],
            roles={r: addr_of(r) for r in ("owner", "bank", "authorizer", "exitKey", "executor", "keeper")},
        )
        if tradeflow:
            keys = anvil_mnemonic_keys()
            addresses.trade_escrow = chain.escrow_address
            addresses.multi_send_call_only = chain.multisend_address
            addresses.issuers = {role: keys[i][0] for role, i in DEMO_ISSUER_INDEX.items()}
        return chain, addresses

    def block_number(self) -> int:
        return self.block

    def block_timestamp(self) -> int:
        return self.now

    def usdc_balance(self, who: str) -> int:
        if who.lower() in self.vaults:
            return self.vaults[who.lower()].total_assets
        return self.usdc.get(who.lower(), 0)

    def vault_name(self, vault: str) -> str:
        return self.vaults[vault.lower()].name

    def vault_total_assets(self, vault: str) -> int:
        return self.vaults[vault.lower()].total_assets

    def vault_idle(self, vault: str) -> int:
        return self.vaults[vault.lower()].total_assets

    def remaining_liquidity(self, vault: str) -> int | None:
        rem = self.vaults[vault.lower()].remaining()
        return None if rem == UINT256_MAX else rem

    def shares_of(self, vault: str, who: str) -> int:
        return self.vaults[vault.lower()].balances.get(who.lower(), 0)

    def convert_to_assets(self, vault: str, shares: int) -> int:
        return self.vaults[vault.lower()].to_assets(shares)

    def preview_deposit(self, vault: str, assets: int) -> int:
        return self.vaults[vault.lower()].to_shares(assets)

    def preview_redeem(self, vault: str, shares: int) -> int:
        return self.vaults[vault.lower()].to_assets(shares)

    def preview_withdraw(self, vault: str, assets: int) -> int:
        return self.vaults[vault.lower()].to_shares(assets, up=True)

    def max_redeem(self, vault: str, owner: str) -> int:
        return self.vaults[vault.lower()].max_redeem(owner)

    def latest_round(self) -> Round:
        return Round(self.round_id, self.answer, self.updated_at)

    def policy(self, safe: str, vaults: list[str]) -> PolicyState:
        p = self.policies.get(safe.lower())
        if p is None:
            p = FakePolicy(owner=ZERO_ADDRESS, bank=ZERO_ADDRESS)
        state = PolicyState(
            safe=to_checksum_address(safe), owner=p.owner, bank=p.bank, authorizer=p.authorizer,
            exit_key=p.exit_key, auto_cap=p.auto_cap, daily_cap=p.daily_cap, bank_limit=p.bank_limit,
            reserve_floor=p.reserve_floor, schedule_hash=hex32(p.schedule_hash), max_band_width=p.max_band_width,
            max_oracle_age=p.max_oracle_age, owner_frozen=p.owner_frozen, bank_frozen=p.bank_frozen,
            policy_version=p.version,
        )
        for v in vaults:
            state.allowed[v.lower()] = v.lower() in p.allowed
            state.quarantined[v.lower()] = v.lower() in p.quarantined_at
            state.quarantined_at[v.lower()] = p.quarantined_at.get(v.lower(), 0)
        return state

    def ever_deposited(self, safe: str, vault: str) -> bool:
        return (safe.lower(), vault.lower()) in self.ever

    def deposited_today(self, safe: str) -> int:
        return self.daily.get((safe.lower(), self.now // 86400), 0)

    def used_nonce(self, safe: str, nonce: int) -> bool:
        return (safe.lower(), nonce) in self.used_nonces

    def module_required_tier(self, safe: str, vault: str, amount: int) -> int:
        p = self.policies[safe.lower()]
        if p.bank_limit != 0 and amount > p.bank_limit:
            return 4
        if amount > p.auto_cap or not self.ever_deposited(safe, vault):
            return 3
        return 2

    def _deposit_checks(self, dar: DAR, approval: Approval, sigs: tuple[str, str, str] | None,
                        execute: bool = True) -> int:
        if dar.op != OP_DEPOSIT:
            raise Revert("WrongOp")
        p = self.policies.get(dar.safe.lower())
        if p is None:
            raise Revert("Unauthorized")
        if p.owner_frozen or p.bank_frozen:
            raise Revert("Frozen")
        if dar.vault.lower() in p.quarantined_at:
            raise Revert("VaultQuarantined")
        if dar.policyVersion != p.version:
            raise Revert("PolicyVersionMismatch")
        if dar.vault.lower() not in p.allowed:
            raise Revert("VaultNotAllowed")
        tier = max(self.module_required_tier(dar.safe, dar.vault, dar.amount), dar.tier)
        if sigs is not None:
            signer = recover_digest(dar_digest(self.chain_id, self.module_address, dar), sigs[0])
            if signer is None or signer.lower() != p.authorizer.lower():
                raise Revert("BadSignature")
        if tier >= 3:
            if to_bytes32(dar.approvalHash) == ZERO32:
                raise Revert("MissingApproval")
            if sigs is not None:
                a_digest = approval_digest(self.chain_id, self.module_address, approval)
                if not sigs[1]:
                    raise Revert("MissingApproval")
                if (recover_digest(a_digest, sigs[1]) or "").lower() != p.owner.lower():
                    raise Revert("BadSignature")
                if tier >= 4:
                    if not sigs[2]:
                        raise Revert("MissingApproval")
                    if (recover_digest(a_digest, sigs[2]) or "").lower() != p.bank.lower():
                        raise Revert("BadSignature")
            if approval_struct_hash(approval) != to_bytes32(dar.approvalHash):
                raise Revert("ApprovalMismatch")
            if (approval.safe.lower(), approval.op, approval.vault.lower()) != (
                    dar.safe.lower(), dar.op, dar.vault.lower()):
                raise Revert("ApprovalMismatch")
            if dar.amount > approval.maxAmount:
                raise Revert("ApprovalExceeded")
            if approval.policyVersion != p.version:
                raise Revert("PolicyVersionMismatch")
            if self.now > approval.approvalExpiry:
                raise Revert("ApprovalExpired")
            if (dar.safe.lower(), approval.approvalNonce) in self.used_nonces:
                raise Revert("NonceUsed")
        if self.now > dar.expiry:
            raise Revert("Expired")
        if (dar.safe.lower(), dar.nonce) in self.used_nonces or (tier >= 3 and dar.nonce == approval.approvalNonce):
            raise Revert("NonceUsed")
        if self.updated_at > self.now or self.now - self.updated_at > p.max_oracle_age:
            raise Revert("StaleOracle")
        if self.answer <= 0 or not (dar.priceLow <= self.answer <= dar.priceHigh):
            raise Revert("PriceOutOfBand")
        if dar.priceHigh - dar.priceLow > p.max_band_width:
            raise Revert("BandTooWide")
        bal = self.usdc_balance(dar.safe)
        if bal < dar.amount or bal - dar.amount < p.reserve_floor:
            raise Revert("ReserveFloorBreached")
        if self.deposited_today(dar.safe) + dar.amount > p.daily_cap:
            raise Revert("DailyCapExceeded")
        if not execute:
            return tier
        v = self.vaults[dar.vault.lower()]
        if v.deposit_reverts:
            raise Revert("ExecutionFailed")
        if v.to_shares(dar.amount) < dar.minOut:
            raise Revert("SlippageExceeded")
        return tier

    def _redeem_checks(self, dar: DAR, sig: str | None, execute: bool = True) -> int:
        p = self.policies.get(dar.safe.lower())
        if p is None:
            raise Revert("Unauthorized")
        if sig is not None:
            signer = (recover_digest(dar_digest(self.chain_id, self.module_address, dar), sig) or "").lower()
            if signer not in (p.authorizer.lower(), p.exit_key.lower()) or signer == ZERO_ADDRESS:
                raise Revert("BadSignature")
        if dar.op != OP_REDEEM:
            raise Revert("WrongOp")
        if self.now > dar.expiry:
            raise Revert("Expired")
        if (dar.safe.lower(), dar.nonce) in self.used_nonces:
            raise Revert("NonceUsed")
        if (dar.safe.lower(), dar.vault.lower()) not in self.ever:
            raise Revert("NoPosition")
        v = self.vaults.get(dar.vault.lower())
        if v is None or dar.amount == 0 or v.balances.get(dar.safe.lower(), 0) < dar.amount:
            raise Revert("NoPosition")
        if not execute:
            return 1
        if v.redeem_reverts or dar.amount > v.max_redeem(dar.safe):
            raise Revert("ExecutionFailed")
        if v.to_assets(dar.amount) < dar.minOut:
            raise Revert("SlippageExceeded")
        return 1

    def module_check(self, dar: DAR, approval: Approval) -> CheckResult:
        with self.lock:
            try:
                if dar.op == OP_REDEEM:
                    tier = self._redeem_checks(dar, None, execute=False)
                else:
                    tier = self._deposit_checks(dar, approval, None, execute=False)
            except Revert as r:
                required = 1 if dar.op == OP_REDEEM else self._safe_required_tier(dar)
                return CheckResult(False, r.name, required)
            return CheckResult(True, None, tier)

    def _safe_required_tier(self, dar: DAR) -> int:
        try:
            return self.module_required_tier(dar.safe, dar.vault, dar.amount)
        except KeyError:
            return 0

    def sim_vault_redeem(self, vault: str, shares: int, safe: str) -> SimResult:
        v = self.vaults[vault.lower()]
        if v.redeem_reverts:
            return SimResult(False, "RedeemDisabled")
        if shares > v.max_redeem(safe):
            return SimResult(False, "ERC4626ExceededMaxRedeem")
        return SimResult(True, None, v.to_assets(shares))

    def sim_deposit_submission(self, dar, auth_sig, owner_sig, bank_sig, approval, sender) -> SimResult:
        with self.lock:
            try:
                self._deposit_checks(dar, approval, (auth_sig, owner_sig or "", bank_sig or ""))
            except Revert as r:
                return SimResult(False, r.name)
            return SimResult(True)

    def sim_redeem_submission(self, dar, sig, sender) -> SimResult:
        with self.lock:
            try:
                self._redeem_checks(dar, sig)
            except Revert as r:
                return SimResult(False, r.name)
            return SimResult(True)

    def _vault_deposit(self, v: FakeVault, owner: str, assets: int) -> int:
        shares = v.to_shares(assets)
        self.usdc[owner.lower()] = self.usdc.get(owner.lower(), 0) - assets
        v.total_assets += assets
        v.total_supply += shares
        v.balances[owner.lower()] = v.balances.get(owner.lower(), 0) + shares
        return shares

    def _vault_redeem(self, v: FakeVault, owner: str, shares: int) -> int:
        assets = v.to_assets(shares)
        v.balances[owner.lower()] -= shares
        v.total_supply -= shares
        v.total_assets -= assets
        if v.liquidity_cap != UINT256_MAX:
            v.withdrawn_since_cap += assets
        self.usdc[owner.lower()] = self.usdc.get(owner.lower(), 0) + assets
        return assets

    def _finish(self, tx: str, status: int, executed: list[dict], reason: str | None) -> str:
        self.mine()
        rec = Receipt(tx, status, self.block, executed, reason)
        self.receipts[tx] = rec
        for e in executed:
            e["blockNumber"] = self.block
            self.logs.append(e)
        return tx

    def submit_deposit(self, key, dar, auth_sig, owner_sig, bank_sig, approval, gas=None) -> str:
        with self.lock:
            tx = self._txhash()
            try:
                tier = self._deposit_checks(dar, approval, (auth_sig, owner_sig or "", bank_sig or ""))
            except Revert as r:
                return self._finish(tx, 0, [], r.name)
            v = self.vaults[dar.vault.lower()]
            shares = self._vault_deposit(v, dar.safe, dar.amount)
            if tier >= 3:
                self.used_nonces.add((dar.safe.lower(), approval.approvalNonce))
            self.used_nonces.add((dar.safe.lower(), dar.nonce))
            self.ever.add((dar.safe.lower(), dar.vault.lower()))
            day = (dar.safe.lower(), self.now // 86400)
            self.daily[day] = self.daily.get(day, 0) + dar.amount
            event = self._executed(dar, tx, dar.amount, shares, tier)
            return self._finish(tx, 1, [event], None)

    def submit_redeem(self, key, dar, sig, gas=None) -> str:
        with self.lock:
            tx = self._txhash()
            try:
                self._redeem_checks(dar, sig)
            except Revert as r:
                return self._finish(tx, 0, [], r.name)
            assets = self._vault_redeem(self.vaults[dar.vault.lower()], dar.safe, dar.amount)
            self.used_nonces.add((dar.safe.lower(), dar.nonce))
            event = self._executed(dar, tx, assets, dar.amount, 1)
            return self._finish(tx, 1, [event], None)

    def _executed(self, dar: DAR, tx: str, assets: int, shares: int, tier: int) -> dict:
        return {
            "event": "AegisExecuted", "safe": to_checksum_address(dar.safe),
            "darHash": hex32(dar_digest(self.chain_id, self.module_address, dar)), "op": dar.op,
            "vault": to_checksum_address(dar.vault), "assets": assets, "shares": shares, "tier": tier,
            "evidenceHash": hex32(to_bytes32(dar.evidenceHash)), "txHash": tx, "blockNumber": self.block,
            "logIndex": len(self.logs),
        }

    def receipt(self, tx_hash: str) -> Receipt | None:
        return self.receipts.get(tx_hash)

    def quarantine(self, key: str, safe: str, vault: str) -> str:
        with self.lock:
            sender = self.address_of(key).lower()
            p = self.policies[safe.lower()]
            tx = self._txhash()
            if sender not in (p.owner.lower(), p.bank.lower(), p.exit_key.lower()):
                return self._finish(tx, 0, [], "Unauthorized")
            if vault.lower() not in p.quarantined_at:
                p.quarantined_at[vault.lower()] = self.now
                self._bump(safe, "quarantine")
                self.logs.append({
                    "event": "Quarantined", "safe": to_checksum_address(safe), "vault": to_checksum_address(vault),
                    "by": to_checksum_address(sender), "txHash": tx, "blockNumber": self.block + 1,
                    "logIndex": len(self.logs),
                })
            return self._finish(tx, 1, [], None)

    def clear_quarantine(self, sender: str, safe: str, vault: str) -> None:
        p = self.policies[safe.lower()]
        if sender.lower() != p.owner.lower():
            raise Revert("Unauthorized")
        at = p.quarantined_at.get(vault.lower())
        if at is not None and self.now < at + 24 * 3600:
            raise Revert("Unauthorized")
        p.quarantined_at.pop(vault.lower(), None)
        self._bump(safe, "clearQuarantine")

    def poke(self, key: str) -> str:
        with self.lock:
            tx = self._txhash()
            if self.address_of(key).lower() not in (self.keeper.lower(), self.admin.lower()):
                return self._finish(tx, 0, [], "Unauthorized")
            self.set_price(self.answer)
            return self._finish(tx, 1, [], None)

    def events(self, safe: str | None = None, from_block: int = 0) -> list[dict]:
        return [dict(e) for e in self.logs
                if e["blockNumber"] >= from_block and (safe is None or e["safe"].lower() == safe.lower())]

    def encode_set_reserve_floor(self, safe: str, floor: int, schedule_hash: str) -> dict:
        from aegis.chain.abi import Contract

        data = Contract("PolicyRegistry").encode("setReserveFloor", to_checksum_address(safe), floor,
                                                 to_bytes32(schedule_hash))
        return {"to": self.registry_address, "data": "0x" + data.hex(), "value": "0"}

    def apply_reserve_floor(self, safe: str, floor: int, schedule_hash: str) -> None:
        """Stands in for the owner wallet sending the floorUpdate transaction."""
        self.set_policy(safe, reserve_floor=floor, schedule_hash=schedule_hash)

    def admin_set_price(self, key: str, answer: int) -> str:
        with self.lock:
            self.set_price(answer)
            return self._finish(self._txhash(), 1, [], None)

    def admin_set_liquidity_cap(self, key: str, vault: str, assets: int) -> str:
        with self.lock:
            v = self.vaults[vault.lower()]
            v.liquidity_cap = assets
            v.withdrawn_since_cap = 0
            return self._finish(self._txhash(), 1, [], None)

    def admin_increase_time(self, seconds: int) -> None:
        with self.lock:
            self.now += seconds
            self.mine()

    def head_timestamp(self) -> int:
        return self.now

    def eth_balance(self, who: str) -> int:
        return self.eth.get(who.lower(), 0)

    def code_size(self, who: str) -> int:
        w = who.lower()
        known = {self.module_address.lower(), self.registry_address.lower(), self.usdc_address.lower(),
                 self.feed_address.lower(), self.escrow_address.lower(), self.multisend_address.lower()}
        return 1 if (w in self.safe_accounts or w in self.vaults or w in known) else 0

    def send_value(self, key: str, to: str, value: int) -> str:
        with self.lock:
            sender = self.address_of(key).lower()
            self.eth[sender] = self.eth.get(sender, 0) - value
            self.eth[to.lower()] = self.eth.get(to.lower(), 0) + value
            return self._finish(self._txhash(), 1, [], None)

    def mint_usdc(self, key: str, to: str, amount: int) -> str:
        with self.lock:
            if self.chain_id != 31337 and self.address_of(key).lower() != self.admin.lower():
                return self._finish(self._txhash(), 0, [], "Unauthorized")
            self.mint(to, amount)
            return self._finish(self._txhash(), 1, [], None)

    def predict_safe(self, owner: str) -> str:
        from aegis.chain.safe import predict_address

        factory, singleton = "0x" + "fa" * 20, "0x" + "5f" * 20
        return predict_address(factory, singleton, owner, "0x" + "fb" * 20, b"fake-proxy")

    def deploy_safe(self, owner: str, enable_module: bool = True) -> str:
        """Stands in for the owner's createProxyWithNonce and enableModule transactions."""
        safe = self.predict_safe(owner)
        modules = {self.module_address.lower()} if enable_module else set()
        self.safe_accounts[safe.lower()] = {"owners": [to_checksum_address(owner)], "threshold": 1,
                                            "modules": modules}
        return safe

    def safe_threshold(self, safe: str) -> int:
        return self.safe_accounts[safe.lower()]["threshold"]

    def safe_owners(self, safe: str) -> list[str]:
        return list(self.safe_accounts[safe.lower()]["owners"])

    def safe_module_enabled(self, safe: str, module: str) -> bool:
        return module.lower() in self.safe_accounts[safe.lower()]["modules"]

    def wait_receipt(self, tx_hash: str, timeout: float = 30.0) -> Receipt | None:
        return self.receipts.get(tx_hash)

    def _escrow_finish(self, tx: str, status: int, events: list[dict], reason: str | None) -> str:
        self.mine()
        self.receipts[tx] = Receipt(tx, status, self.block, list(events), reason)
        for e in events:
            e.update({"txHash": tx, "blockNumber": self.block, "logIndex": len(self.escrow_logs)})
            self.escrow_logs.append(e)
        return tx

    def _escrow_tx(self, fn) -> str:
        with self.lock:
            tx = self._txhash()
            try:
                events = fn()
            except Revert as r:
                return self._escrow_finish(tx, 0, [], r.name)
            return self._escrow_finish(tx, 1, events, None)

    def create_order(self, buyer: str, supplier: str, total: int, terms_hash: str | bytes,
                     ms: list[MilestoneTerms]) -> tuple[str, int | None]:
        """Stands in for the owner's MultiSendCallOnly Safe transaction: approve(escrow, total) + createOrder."""
        created: list[int] = []

        def run() -> list[dict]:
            p = self.policies.get(buyer.lower())
            if p is None or p.owner.lower() == ZERO_ADDRESS:
                raise Revert("NotRegistered")
            if p.owner_frozen or p.bank_frozen:
                raise Revert("Frozen")
            if supplier.lower() in (ZERO_ADDRESS, buyer.lower(), self.escrow_address.lower(),
                                    self.usdc_address.lower()):
                raise Revert("BadSupplier")
            for i, m in enumerate(ms):
                if m.amount == 0 or m.kind != i or (m.checkTemp and m.minTempCenti > m.maxTempCenti):
                    raise Revert("BadMilestone")
            for m in ms:
                if m.issuer.lower() in (ZERO_ADDRESS, supplier.lower()):
                    raise Revert("BadIssuer")
            if sum(m.amount for m in ms) != total:
                raise Revert("AmountMismatch")
            if not (self.now < ms[0].deadline <= ms[1].deadline <= ms[2].deadline):
                raise Revert("BadDeadline")
            if self.usdc.get(buyer.lower(), 0) < total:
                raise Revert("ERC20InsufficientBalance")
            oid = self.next_order_id
            self.next_order_id += 1
            order = Order(oid, to_checksum_address(buyer), to_checksum_address(supplier), self.now, 0, ACTIVE, total,
                          0, to_bytes32(terms_hash))
            self.orders[oid] = {"order": order, "terms": list(ms), "status": [0, 0, 0]}
            self.committed[buyer.lower()] = self.committed.get(buyer.lower(), 0) + total
            self.escrowed_total += total
            self.usdc[buyer.lower()] -= total
            self.mint(self.escrow_address, total)
            created.append(oid)
            return [{"event": "OrderCreated", "orderId": oid, "buyer": order.buyer, "supplier": order.supplier,
                     "total": total, "termsHash": hex32(order.termsHash)}]

        tx = self._escrow_tx(run)
        return tx, (created[0] if created else None)

    def _release_checks(self, order_id: int, index: int, proof: MilestoneProof, issuer_sig: str | None,
                        auth: ReleaseAuthorization, auth_sig: str | None) -> None:
        rec = self.orders.get(order_id)
        if rec is None or rec["order"].status != ACTIVE:
            raise Revert("OrderNotActive")
        o = rec["order"]
        if index != o.nextIndex:
            raise Revert("OutOfOrder")
        t = rec["terms"][index]
        p = self.policies[o.buyer.lower()]
        if p.owner_frozen or p.bank_frozen:
            raise Revert("Frozen")
        if proof.orderId != order_id or proof.index != index or proof.kind != t.kind:
            raise Revert("ProofMismatch")
        if issuer_sig is not None:
            signer = recover_digest(proof_digest(self.chain_id, self.escrow_address, proof), issuer_sig)
            if signer is None or signer.lower() != t.issuer.lower():
                raise Revert("BadSignature")
        if not (o.createdAt <= proof.issuedAt <= self.now):
            raise Revert("BadProofTime")
        if not conditions_hold(t, proof):
            raise Revert("ConditionNotMet")
        if auth_sig is not None:
            signer = (recover_digest(auth_digest(self.chain_id, self.escrow_address, auth), auth_sig) or "").lower()
            if signer in ("", ZERO_ADDRESS) or signer != p.authorizer.lower() or signer == p.exit_key.lower():
                raise Revert("BadSignature")
        if (auth.orderId, auth.index, auth.amount, to_bytes32(auth.proofHash)) != (
                order_id, index, t.amount, proof_struct_hash(proof)):
            raise Revert("AuthorizationMismatch")
        if auth.policyVersion != p.version:
            raise Revert("PolicyVersionMismatch")
        if self.now > auth.expiry:
            raise Revert("Expired")
        if (o.buyer.lower(), auth.nonce) in self.escrow_nonces:
            raise Revert("NonceUsed")

    def _pay(self, order_id: int, index: int, status: int) -> dict:
        rec = self.orders[order_id]
        o, t = rec["order"], rec["terms"][index]
        rec["status"][index] = status
        nxt = o.nextIndex + 1
        rec["order"] = replace(o, nextIndex=nxt, released=o.released + t.amount,
                               status=ORDER_COMPLETED if nxt == 3 else o.status)
        self.committed[o.buyer.lower()] -= t.amount
        self.escrowed_total -= t.amount
        self.usdc[self.escrow_address.lower()] -= t.amount
        self.mint(o.supplier, t.amount)
        return {"event": "MilestoneReleased", "orderId": order_id, "index": index, "supplier": o.supplier,
                "amount": t.amount}

    def escrow_order(self, order_id: int) -> Order:
        rec = self.orders.get(int(order_id))
        if rec is None:
            return Order(int(order_id), ZERO_ADDRESS, ZERO_ADDRESS, 0, 0, 0, 0, 0, ZERO32)
        return rec["order"]

    def escrow_milestones(self, order_id: int) -> list[tuple[MilestoneTerms, int]]:
        rec = self.orders.get(int(order_id))
        if rec is None:
            empty = MilestoneTerms(0, ZERO_ADDRESS, 0, False, False, 0, 0, 0)
            return [(empty, 0)] * 3
        return list(zip(rec["terms"], rec["status"]))

    def escrow_committed_of(self, safe: str) -> int:
        return self.committed.get(safe.lower(), 0)

    def escrow_used_nonce(self, buyer: str, nonce: int) -> bool:
        return (buyer.lower(), nonce) in self.escrow_nonces

    def escrow_check_release(self, order_id, index, proof, auth) -> SimResult:
        with self.lock:
            try:
                self._release_checks(order_id, index, proof, None, auth, None)
            except Revert as r:
                return SimResult(False, r.name)
            return SimResult(True)

    def sim_release(self, order_id, index, proof, issuer_sig, auth, auth_sig, sender) -> SimResult:
        with self.lock:
            try:
                self._release_checks(order_id, index, proof, issuer_sig or "", auth, auth_sig or "")
            except Revert as r:
                return SimResult(False, r.name)
            return SimResult(True)

    def submit_release(self, key, order_id, index, proof, issuer_sig, auth, auth_sig, gas=None) -> str:
        def run() -> list[dict]:
            self._release_checks(order_id, index, proof, issuer_sig or "", auth, auth_sig or "")
            buyer = self.orders[order_id]["order"].buyer
            self.escrow_nonces.add((buyer.lower(), auth.nonce))
            ev = self._pay(order_id, index, M_RELEASED)
            return [{**ev, "proofHash": hex32(proof_struct_hash(proof)),
                     "authHash": hex32(auth_digest(self.chain_id, self.escrow_address, auth)), "waived": False}]

        return self._escrow_tx(run)

    def escrow_waive(self, sender: str, order_id: int, index: int) -> str:
        """Stands in for the owner's Safe transaction calling waive(orderId, index)."""

        def run() -> list[dict]:
            rec = self.orders.get(order_id)
            if rec is None or sender.lower() != rec["order"].buyer.lower():
                raise Revert("Unauthorized")
            o = rec["order"]
            if o.status != ACTIVE:
                raise Revert("OrderNotActive")
            if index != o.nextIndex:
                raise Revert("OutOfOrder")
            p = self.policies[o.buyer.lower()]
            if p.owner_frozen or p.bank_frozen:
                raise Revert("Frozen")
            ev = self._pay(order_id, index, M_WAIVED)
            return [{**ev, "proofHash": hex32(ZERO32), "authHash": hex32(ZERO32), "waived": True}]

        return self._escrow_tx(run)

    def escrow_refund(self, sender: str, order_id: int) -> str:
        """Stands in for the owner's Safe transaction calling refund(orderId)."""

        def run() -> list[dict]:
            rec = self.orders.get(order_id)
            if rec is None or sender.lower() != rec["order"].buyer.lower():
                raise Revert("Unauthorized")
            o = rec["order"]
            if o.status != ACTIVE:
                raise Revert("OrderNotActive")
            if self.now <= rec["terms"][o.nextIndex].deadline:
                raise Revert("DeadlineNotPassed")
            amount_left = o.total - o.released
            for i in range(o.nextIndex, 3):
                rec["status"][i] = M_REFUNDED
            rec["order"] = replace(o, status=ORDER_REFUNDED)
            self.committed[o.buyer.lower()] -= amount_left
            self.escrowed_total -= amount_left
            self.usdc[self.escrow_address.lower()] -= amount_left
            self.mint(o.buyer, amount_left)
            return [{"event": "OrderRefunded", "orderId": order_id, "buyer": o.buyer, "amount": amount_left}]

        return self._escrow_tx(run)

    def escrow_events(self, from_block: int, to_block: int) -> list[dict]:
        return [dict(e) for e in self.escrow_logs if from_block <= e["blockNumber"] <= to_block]
