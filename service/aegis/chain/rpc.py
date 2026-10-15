from __future__ import annotations

import itertools
import os
import time

import httpx
from eth_account import Account
from eth_utils import to_checksum_address

from aegis.chain.abi import Contract, decode_revert, error_name
from aegis.chain.base import ChainClient, CheckResult, PolicyState, Receipt, Round, SimResult
from aegis.config import UINT256_MAX, Settings
from aegis.eip712 import DAR, Approval, hex32, to_bytes32


LOG_WINDOW = int(os.environ.get("LOG_WINDOW", "5000"))


class RpcError(Exception):
    def __init__(self, code: int, message: str, data: bytes | None = None):
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message
        self.data = data


class CallReverted(Exception):
    def __init__(self, data: bytes | None, message: str = ""):
        self.data = data
        self.reason = decode_revert(data) if data else (message or "Reverted")
        super().__init__(self.reason)


def _hex_to_bytes(value) -> bytes | None:
    if isinstance(value, str) and value.startswith("0x"):
        try:
            return bytes.fromhex(value[2:])
        except ValueError:
            return None
    if isinstance(value, dict):
        return _hex_to_bytes(value.get("data"))
    return None


def _addr_topic(addr: str) -> str:
    return "0x" + "0" * 24 + addr.lower().removeprefix("0x")


class RpcChain(ChainClient):
    def __init__(self, settings: Settings):
        self.settings = settings
        self.url = settings.rpc_url
        self.chain_id = settings.chain_id
        self.addr = settings.addresses
        out = settings.contracts_out
        self.usdc = Contract("MockUSDC", out)
        self.feed = Contract("MockPriceFeed", out)
        self.vault = Contract("MockVault", out)
        self.registry = Contract("PolicyRegistry", out)
        self.module = Contract("AegisModule", out)
        self._http = httpx.Client(timeout=15)
        self._ids = itertools.count(1)

    def _rpc(self, method: str, params: list):
        body = {"jsonrpc": "2.0", "id": next(self._ids), "method": method, "params": params}
        for attempt in range(5):
            resp = self._http.post(self.url, json=body)
            if resp.status_code != 429:
                break
            time.sleep(0.5 * 2**attempt)
        resp.raise_for_status()
        payload = resp.json()
        if "error" in payload:
            err = payload["error"]
            raise RpcError(err.get("code", -1), err.get("message", ""), _hex_to_bytes(err.get("data")))
        return payload["result"]

    def _eth_call(self, to: str, data: bytes, sender: str | None = None, block: str = "latest") -> bytes:
        tx = {"to": to_checksum_address(to), "data": "0x" + data.hex()}
        if sender:
            tx["from"] = to_checksum_address(sender)
        try:
            return bytes.fromhex(self._rpc("eth_call", [tx, block])[2:])
        except RpcError as e:
            if e.data is not None or "revert" in e.message.lower():
                raise CallReverted(e.data, e.message) from None
            raise

    def _view(self, contract: Contract, address: str, fn: str, *args):
        return contract.decode(fn, self._eth_call(address, contract.encode(fn, *args)))

    def _send(self, key: str, to: str, data: bytes) -> str:
        acct = Account.from_key(key)
        tx_call = {"from": acct.address, "to": to_checksum_address(to), "data": "0x" + data.hex()}
        try:
            gas = int(self._rpc("eth_estimateGas", [tx_call]), 16)
        except RpcError as e:
            raise CallReverted(e.data, e.message) from None
        nonce = int(self._rpc("eth_getTransactionCount", [acct.address, "pending"]), 16)
        block = self._rpc("eth_getBlockByNumber", ["latest", False])
        base = int(block.get("baseFeePerGas", "0x0"), 16)
        try:
            tip = int(self._rpc("eth_maxPriorityFeePerGas", []), 16)
        except RpcError:
            tip = 10**9
        tx = {
            "type": 2, "chainId": self.chain_id, "nonce": nonce, "to": to_checksum_address(to),
            "data": "0x" + data.hex(), "value": 0, "gas": gas * 13 // 10 + 20_000,
            "maxFeePerGas": base * 2 + tip, "maxPriorityFeePerGas": tip,
        }
        signed = Account.sign_transaction(tx, key)
        return self._rpc("eth_sendRawTransaction", ["0x" + bytes(signed.raw_transaction).hex()])

    def block_number(self) -> int:
        return int(self._rpc("eth_blockNumber", []), 16)

    def block_timestamp(self) -> int:
        block = self._rpc("eth_getBlockByNumber", ["latest", False])
        chain_ts = int(block["timestamp"], 16)
        # Anvil without --block-time only mines on transactions; its next block uses wall time.
        return max(chain_ts, int(time.time())) if self.chain_id == 31337 else chain_ts

    def usdc_balance(self, who: str) -> int:
        return self._view(self.usdc, self.addr.usdc, "balanceOf", to_checksum_address(who))

    def vault_name(self, vault: str) -> str:
        try:
            return self._view(self.vault, vault, "name")
        except (CallReverted, RpcError):
            return ""

    def vault_total_assets(self, vault: str) -> int:
        return self._view(self.vault, vault, "totalAssets")

    def vault_idle(self, vault: str) -> int:
        return self.usdc_balance(vault)

    def remaining_liquidity(self, vault: str) -> int | None:
        try:
            value = self._view(self.vault, vault, "remainingLiquidity")
        except (CallReverted, RpcError):
            return None
        return None if value == UINT256_MAX else value

    def shares_of(self, vault: str, who: str) -> int:
        return self._view(self.vault, vault, "balanceOf", to_checksum_address(who))

    def convert_to_assets(self, vault: str, shares: int) -> int:
        return self._view(self.vault, vault, "convertToAssets", shares)

    def preview_deposit(self, vault: str, assets: int) -> int:
        return self._view(self.vault, vault, "previewDeposit", assets)

    def preview_redeem(self, vault: str, shares: int) -> int:
        return self._view(self.vault, vault, "previewRedeem", shares)

    def preview_withdraw(self, vault: str, assets: int) -> int:
        return self._view(self.vault, vault, "previewWithdraw", assets)

    def max_redeem(self, vault: str, owner: str) -> int:
        return self._view(self.vault, vault, "maxRedeem", to_checksum_address(owner))

    def latest_round(self) -> Round:
        rid, answer, _, updated, _ = self._view(self.feed, self.addr.price_feed, "latestRoundData")
        return Round(rid, answer, updated)

    def policy(self, safe: str, vaults: list[str]) -> PolicyState:
        reg, r = self.addr.registry, self.registry
        s = to_checksum_address(safe)

        def g(fn, *args):
            return self._view(r, reg, fn, s, *args)

        state = PolicyState(
            safe=s, owner=to_checksum_address(g("owner")), bank=to_checksum_address(g("bank")),
            authorizer=to_checksum_address(g("authorizer")), exit_key=to_checksum_address(g("exitKey")),
            auto_cap=g("autoCap"), daily_cap=g("dailyCap"), bank_limit=g("bankLimit"),
            reserve_floor=g("reserveFloor"), schedule_hash=hex32(g("scheduleHash")),
            max_band_width=g("maxBandWidth"), max_oracle_age=g("maxOracleAge"),
            owner_frozen=g("ownerFrozen"), bank_frozen=g("bankFrozen"), policy_version=g("policyVersion"),
        )
        for v in vaults:
            cv = to_checksum_address(v)
            state.allowed[v.lower()] = g("allowedVault", cv)
            state.quarantined[v.lower()] = g("quarantined", cv)
            state.quarantined_at[v.lower()] = g("quarantinedAt", cv)
        return state

    def ever_deposited(self, safe: str, vault: str) -> bool:
        return self._view(self.module, self.addr.module, "everDeposited", to_checksum_address(safe),
                          to_checksum_address(vault))

    def deposited_today(self, safe: str) -> int:
        return self._view(self.module, self.addr.module, "depositedToday", to_checksum_address(safe))

    def used_nonce(self, safe: str, nonce: int) -> bool:
        return self._view(self.module, self.addr.module, "usedNonce", to_checksum_address(safe), nonce)

    def module_required_tier(self, safe: str, vault: str, amount: int) -> int:
        return self._view(self.module, self.addr.module, "requiredTier", to_checksum_address(safe),
                          to_checksum_address(vault), amount)

    def module_check(self, dar: DAR, approval: Approval) -> CheckResult:
        try:
            ok, selector, tier = self._view(self.module, self.addr.module, "check", dar.as_tuple(),
                                            approval.as_tuple())
        except CallReverted as e:
            return CheckResult(False, e.reason, 0)
        return CheckResult(bool(ok), None if ok else error_name(selector), int(tier))

    def sim_vault_redeem(self, vault: str, shares: int, safe: str) -> SimResult:
        s = to_checksum_address(safe)
        try:
            out = self._eth_call(vault, self.vault.encode("redeem", shares, s, s), sender=s)
        except CallReverted as e:
            return SimResult(False, e.reason)
        return SimResult(True, None, self.vault.decode("redeem", out))

    def _deposit_data(self, dar, auth_sig, owner_sig, bank_sig, approval) -> bytes:
        return self.module.encode(
            "deposit", dar.as_tuple(), _sig(auth_sig), _sig(owner_sig), _sig(bank_sig), approval.as_tuple()
        )

    def sim_deposit_submission(self, dar, auth_sig, owner_sig, bank_sig, approval, sender) -> SimResult:
        try:
            self._eth_call(self.addr.module, self._deposit_data(dar, auth_sig, owner_sig, bank_sig, approval),
                           sender=sender)
        except CallReverted as e:
            return SimResult(False, e.reason)
        return SimResult(True)

    def sim_redeem_submission(self, dar, sig, sender) -> SimResult:
        try:
            self._eth_call(self.addr.module, self.module.encode("redeem", dar.as_tuple(), _sig(sig)), sender=sender)
        except CallReverted as e:
            return SimResult(False, e.reason)
        return SimResult(True)

    def submit_deposit(self, key, dar, auth_sig, owner_sig, bank_sig, approval) -> str:
        return self._send(key, self.addr.module, self._deposit_data(dar, auth_sig, owner_sig, bank_sig, approval))

    def submit_redeem(self, key, dar, sig) -> str:
        return self._send(key, self.addr.module, self.module.encode("redeem", dar.as_tuple(), _sig(sig)))

    def receipt(self, tx_hash: str) -> Receipt | None:
        rec = self._rpc("eth_getTransactionReceipt", [tx_hash])
        if rec is None:
            return None
        status = int(rec["status"], 16)
        block = int(rec["blockNumber"], 16)
        executed = []
        topic = "0x" + self.module.topic("AegisExecuted").hex()
        for log in rec.get("logs", []):
            if log["address"].lower() == self.addr.module.lower() and log["topics"] and log["topics"][0] == topic:
                executed.append(self._decode_executed(log))
        reason = None
        if status == 0:
            reason = self._replay_reason(tx_hash, block)
        return Receipt(tx_hash, status, block, executed, reason)

    def _replay_reason(self, tx_hash: str, block: int) -> str:
        tx = self._rpc("eth_getTransactionByHash", [tx_hash])
        try:
            self._eth_call(tx["to"], bytes.fromhex(tx["input"][2:]), sender=tx["from"], block=hex(block - 1))
        except CallReverted as e:
            return e.reason
        except RpcError:
            pass
        return "Reverted"

    def _decode_executed(self, log: dict) -> dict:
        topics = [bytes.fromhex(t[2:]) for t in log["topics"]]
        d = self.module.decode_log("AegisExecuted", topics, bytes.fromhex(log["data"][2:]))
        return {
            "event": "AegisExecuted", "safe": to_checksum_address(d["safe"]), "darHash": hex32(d["darHash"]),
            "op": int(d["op"]), "vault": to_checksum_address(d["vault"]), "assets": int(d["assets"]),
            "shares": int(d["shares"]), "tier": int(d["tier"]), "evidenceHash": hex32(d["evidenceHash"]),
            "txHash": log["transactionHash"], "blockNumber": int(log["blockNumber"], 16),
            "logIndex": int(log["logIndex"], 16),
        }

    def quarantine(self, key: str, safe: str, vault: str) -> str:
        data = self.registry.encode("quarantine", to_checksum_address(safe), to_checksum_address(vault))
        return self._send(key, self.addr.registry, data)

    def poke(self, key: str) -> str:
        return self._send(key, self.addr.price_feed, self.feed.encode("poke"))

    def events(self, safe: str | None = None, from_block: int = 0) -> list[dict]:
        topics0 = [
            "0x" + self.module.topic("AegisExecuted").hex(),
            "0x" + self.registry.topic("PolicyChanged").hex(),
            "0x" + self.registry.topic("Quarantined").hex(),
        ]
        topics: list = [topics0]
        if safe:
            topics.append(_addr_topic(safe))
        start = max(from_block, self.addr.deploy_block)
        head = self.block_number()
        logs = []
        # Public RPCs cap eth_getLogs ranges, so query in windows.
        while start <= head:
            end = min(head, start + LOG_WINDOW - 1)
            logs.extend(self._rpc("eth_getLogs", [{
                "fromBlock": hex(start), "toBlock": hex(end),
                "address": [to_checksum_address(self.addr.module), to_checksum_address(self.addr.registry)],
                "topics": topics,
            }]))
            start = end + 1
        out = []
        for log in logs:
            t0 = log["topics"][0]
            topics_b = [bytes.fromhex(t[2:]) for t in log["topics"]]
            data = bytes.fromhex(log["data"][2:])
            base = {"txHash": log["transactionHash"], "blockNumber": int(log["blockNumber"], 16),
                    "logIndex": int(log["logIndex"], 16)}
            if t0 == topics0[0]:
                out.append(self._decode_executed(log))
            elif t0 == topics0[1]:
                d = self.registry.decode_log("PolicyChanged", topics_b, data)
                out.append({"event": "PolicyChanged", "safe": to_checksum_address(d["safe"]),
                            "version": int(d["version"]), "selector": "0x" + bytes(d["selector"]).hex(), **base})
            else:
                d = self.registry.decode_log("Quarantined", topics_b, data)
                out.append({"event": "Quarantined", "safe": to_checksum_address(d["safe"]),
                            "vault": to_checksum_address(d["vault"]), "by": to_checksum_address(d["by"]), **base})
        return out

    def encode_set_reserve_floor(self, safe: str, floor: int, schedule_hash: str) -> dict:
        data = self.registry.encode("setReserveFloor", to_checksum_address(safe), floor, to_bytes32(schedule_hash))
        return {"to": to_checksum_address(self.addr.registry), "data": "0x" + data.hex(), "value": "0"}

    def admin_set_price(self, key: str, answer: int) -> str:
        return self._send(key, self.addr.price_feed, self.feed.encode("setPrice", answer))

    def admin_set_liquidity_cap(self, key: str, vault: str, assets: int) -> str:
        return self._send(key, vault, self.vault.encode("setLiquidityCap", assets))

    def admin_increase_time(self, seconds: int) -> None:
        self._rpc("evm_increaseTime", [seconds])
        self._rpc("evm_mine", [])

    def wait_receipt(self, tx_hash: str, timeout: float = 30.0) -> Receipt | None:
        deadline = time.time() + timeout
        while time.time() < deadline:
            rec = self.receipt(tx_hash)
            if rec is not None:
                return rec
            time.sleep(0.5)
        return None


def _sig(sig: str | None) -> bytes:
    if not sig:
        return b""
    return bytes.fromhex(sig.removeprefix("0x"))
