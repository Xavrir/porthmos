from __future__ import annotations

import copy
import itertools
import os
import threading
import time

import httpx
from eth_abi import encode as abi_encode
from eth_account import Account
from eth_utils import keccak, to_checksum_address

from aegis.chain import safe as safe_lib
from aegis.chain.abi import Contract, decode_revert, error_name
from aegis.chain.base import ChainClient, CheckResult, PolicyState, Receipt, Round, SimResult
from aegis.chain.erc6492 import ERC6492_VALIDATOR_BYTECODE
from aegis.config import UINT256_MAX, Settings
from aegis.eip712 import DAR, Approval, hex32, to_bytes32
from aegis.tradeflow.typed import MilestoneTerms, Order

LOG_WINDOW = int(os.environ.get("LOG_WINDOW", "5000"))
RPC_BATCH_SIZE = int(os.environ.get("RPC_BATCH_SIZE", "50"))

_local = threading.local()


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


def _result(payload: dict):
    if "error" in payload:
        err = payload["error"]
        raise RpcError(err.get("code", -1), err.get("message", ""), _hex_to_bytes(err.get("data")))
    return payload["result"]


class _Pending:
    __slots__ = ("body", "done", "result", "error")

    def __init__(self, body: dict):
        self.body = body
        self.done = False
        self.result = None
        self.error: Exception | None = None


class _Rounds:
    """Runs gather() tasks on threads and parks each RPC call they make. Once every task is parked or finished, the
    parked calls go out as one JSON-RPC batch, so a stage of independent reads costs one round trip."""

    def __init__(self, send):
        self._send = send
        self._cond = threading.Condition()
        self._running = 0
        self._queue: list[_Pending] = []

    def call(self, body: dict):
        p = _Pending(body)
        with self._cond:
            self._queue.append(p)
            self._running -= 1
            self._cond.notify_all()
            self._cond.wait_for(lambda: p.done)
        if p.error is not None:
            raise p.error
        return p.result

    def run(self, fns: list, nested: bool) -> list:
        if not fns:
            return []
        results: list = [None] * len(fns)
        errors: list[BaseException | None] = [None] * len(fns)
        left = len(fns)

        def work(i, fn):
            nonlocal left
            _local.rounds = self
            try:
                results[i] = fn()
            except BaseException as e:
                errors[i] = e
            finally:
                with self._cond:
                    self._running -= 1
                    left -= 1
                    if left == 0 and nested:
                        # Counted for the parent before it wakes, so no round fires while it is about to resume.
                        self._running += 1
                    self._cond.notify_all()

        with self._cond:
            self._running += len(fns) - (1 if nested else 0)
        for i, fn in enumerate(fns):
            threading.Thread(target=work, args=(i, fn), daemon=True).start()
        if nested:
            with self._cond:
                self._cond.wait_for(lambda: left == 0)
        else:
            self._drive(lambda: left == 0)
        for e in errors:
            if e is not None:
                raise e
        return results

    def _drive(self, finished) -> None:
        while True:
            with self._cond:
                self._cond.wait_for(lambda: finished() or (self._running == 0 and bool(self._queue)))
                if finished():
                    return
                batch, self._queue = self._queue, []
            try:
                self._send(batch)
            except Exception as e:
                for p in batch:
                    p.error = e
            with self._cond:
                self._running += len(batch)
                for p in batch:
                    p.done = True
                self._cond.notify_all()


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
        self.safe = Contract("Safe", out)
        self.factory = Contract("SafeProxyFactory", out)
        self.escrow = Contract("TradeEscrow", out)
        self._http = httpx.Client(timeout=15)
        self._ids = itertools.count(1)
        self._send_locks: dict[str, threading.Lock] = {}
        self._send_guard = threading.Lock()
        self._proxy_code: bytes | None = None
        self._block_tag = "latest"
        self._caps = {"batch": True}

    def _post(self, body):
        for attempt in range(5):
            resp = self._http.post(self.url, json=body)
            if resp.status_code != 429:
                break
            time.sleep(0.5 * 2**attempt)
        resp.raise_for_status()
        return resp.json()

    def _rpc(self, method: str, params: list):
        body = {"jsonrpc": "2.0", "id": next(self._ids), "method": method, "params": params}
        rounds = getattr(_local, "rounds", None)
        if rounds is not None:
            return rounds.call(body)
        return _result(self._post(body))

    def _send_round(self, batch: list[_Pending]) -> None:
        for i in range(0, len(batch), RPC_BATCH_SIZE):
            chunk = batch[i:i + RPC_BATCH_SIZE]
            replies = self._post_batch([p.body for p in chunk]) if len(chunk) > 1 and self._caps["batch"] else None
            for p in chunk:
                try:
                    p.result = _result(replies[p.body["id"]] if replies is not None else self._post(p.body))
                except Exception as e:
                    p.error = e

    def _post_batch(self, bodies: list[dict]) -> dict | None:
        """Replies by id, or None when the endpoint does not take batches; the calls then go one by one."""
        try:
            payload = self._post(bodies)
        except httpx.HTTPStatusError as e:
            if e.response.status_code >= 500:
                raise
            payload = None
        except ValueError:
            payload = None
        replies = {r.get("id"): r for r in payload if isinstance(r, dict)} if isinstance(payload, list) else {}
        if any(b["id"] not in replies for b in bodies):
            self._caps["batch"] = False
            return None
        return replies

    def gather(self, fns: list) -> list:
        rounds = getattr(_local, "rounds", None)
        if rounds is not None:
            return rounds.run(fns, nested=True)
        return _Rounds(self._send_round).run(fns, nested=False)

    def at_block(self, block: int) -> RpcChain:
        pinned = copy.copy(self)
        pinned._block_tag = hex(block)
        return pinned

    def _eth_call(self, to: str, data: bytes, sender: str | None = None, block: str | None = None) -> bytes:
        tx = {"to": to_checksum_address(to), "data": "0x" + data.hex()}
        if sender:
            tx["from"] = to_checksum_address(sender)
        try:
            return bytes.fromhex(self._rpc("eth_call", [tx, block or self._block_tag])[2:])
        except RpcError as e:
            if e.data is not None or "revert" in e.message.lower():
                raise CallReverted(e.data, e.message) from None
            raise

    def _view(self, contract: Contract, address: str, fn: str, *args):
        return contract.decode(fn, self._eth_call(address, contract.encode(fn, *args)))

    def _send(self, key: str, to: str, data: bytes, value: int = 0, gas: int | None = None) -> str:
        """gas=None estimates (and raises CallReverted on a revert); a fixed gas sends even a reverting call."""
        acct = Account.from_key(key)
        if gas is None:
            tx_call = {"from": acct.address, "to": to_checksum_address(to), "data": "0x" + data.hex(),
                       "value": hex(value)}
            try:
                gas = int(self._rpc("eth_estimateGas", [tx_call]), 16) * 13 // 10 + 20_000
            except RpcError as e:
                raise CallReverted(e.data, e.message) from None
        with self._sender_lock(acct.address):
            nonce = int(self._rpc("eth_getTransactionCount", [acct.address, "pending"]), 16)
            block = self._rpc("eth_getBlockByNumber", ["latest", False])
            base = int(block.get("baseFeePerGas", "0x0"), 16)
            try:
                tip = int(self._rpc("eth_maxPriorityFeePerGas", []), 16)
            except RpcError:
                tip = 10**9
            tx = {
                "type": 2, "chainId": self.chain_id, "nonce": nonce, "to": to_checksum_address(to),
                "data": "0x" + data.hex(), "value": value, "gas": gas,
                "maxFeePerGas": base * 2 + tip, "maxPriorityFeePerGas": tip,
            }
            signed = Account.sign_transaction(tx, key)
            return self._rpc("eth_sendRawTransaction", ["0x" + bytes(signed.raw_transaction).hex()])

    def _sender_lock(self, address: str) -> threading.Lock:
        # Two concurrent sends from one key would read the same pending nonce.
        with self._send_guard:
            return self._send_locks.setdefault(address.lower(), threading.Lock())

    def send(self, key: str, to: str, data: bytes, value: int = 0, gas: int | None = None) -> str:
        return self._send(key, to, data, value, gas)

    def head_timestamp(self) -> int:
        return int(self._rpc("eth_getBlockByNumber", ["latest", False])["timestamp"], 16)

    def eth_balance(self, who: str) -> int:
        return int(self._rpc("eth_getBalance", [to_checksum_address(who), "latest"]), 16)

    def code_size(self, who: str) -> int:
        code = self._rpc("eth_getCode", [to_checksum_address(who), "latest"])
        return max(0, (len(code) - 2) // 2)

    def erc1271_valid(self, account: str, digest: bytes, signature: bytes) -> bool:
        selector = keccak(text="isValidSignature(bytes32,bytes)")[:4]
        data = selector + abi_encode(["bytes32", "bytes"], [digest, signature])
        try:
            out = self._eth_call(account, data)
        except (CallReverted, RpcError):
            return False
        return len(out) >= 4 and out[:4] == bytes.fromhex("1626ba7e")

    def erc6492_valid(self, account: str, digest: bytes, signature: bytes) -> bool:
        data = ERC6492_VALIDATOR_BYTECODE + abi_encode(["address", "bytes32", "bytes"],
                                                       [to_checksum_address(account), digest, signature])
        try:
            out = self._rpc("eth_call", [{"data": "0x" + data.hex()}, "latest"])
        except RpcError:
            return False
        return isinstance(out, str) and out.lower() in ("0x01", "0x" + "00" * 31 + "01")

    def send_value(self, key: str, to: str, value: int) -> str:
        return self._send(key, to, b"", value=value, gas=21_000)

    def mint_usdc(self, key: str, to: str, amount: int) -> str:
        return self._send(key, self.addr.usdc, self.usdc.encode("mint", to_checksum_address(to), amount))

    def predict_safe(self, owner: str) -> str:
        if self._proxy_code is None:
            self._proxy_code = self._view(self.factory, self.addr.safe_proxy_factory, "proxyCreationCode")
        a = self.addr
        return safe_lib.predict_address(a.safe_proxy_factory, a.safe_singleton, owner, a.fallback_handler,
                                        self._proxy_code)

    def safe_threshold(self, safe: str) -> int:
        return self._view(self.safe, safe, "getThreshold")

    def safe_owners(self, safe: str) -> list[str]:
        return [to_checksum_address(o) for o in self._view(self.safe, safe, "getOwners")]

    def safe_module_enabled(self, safe: str, module: str) -> bool:
        return self._view(self.safe, safe, "isModuleEnabled", to_checksum_address(module))

    def block_number(self) -> int:
        return int(self._rpc("eth_blockNumber", []), 16)

    def block_timestamp(self) -> int:
        return self.block_header()[1]

    def block_header(self) -> tuple[int, int]:
        block = self._rpc("eth_getBlockByNumber", ["latest", False])
        chain_ts = int(block["timestamp"], 16)
        # Anvil without --block-time only mines on transactions; its next block uses wall time.
        return int(block["number"], 16), max(chain_ts, int(time.time())) if self.chain_id == 31337 else chain_ts

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
            return lambda: self._view(r, reg, fn, s, *args)

        fields = ("owner", "bank", "authorizer", "exitKey", "autoCap", "dailyCap", "bankLimit", "reserveFloor",
                  "scheduleHash", "maxBandWidth", "maxOracleAge", "ownerFrozen", "bankFrozen", "policyVersion")
        per_vault = ("allowedVault", "quarantined", "quarantinedAt")
        out = self.gather([g(f) for f in fields] +
                          [g(f, to_checksum_address(v)) for v in vaults for f in per_vault])
        p = dict(zip(fields, out))
        state = PolicyState(
            safe=s, owner=to_checksum_address(p["owner"]), bank=to_checksum_address(p["bank"]),
            authorizer=to_checksum_address(p["authorizer"]), exit_key=to_checksum_address(p["exitKey"]),
            auto_cap=p["autoCap"], daily_cap=p["dailyCap"], bank_limit=p["bankLimit"],
            reserve_floor=p["reserveFloor"], schedule_hash=hex32(p["scheduleHash"]),
            max_band_width=p["maxBandWidth"], max_oracle_age=p["maxOracleAge"],
            owner_frozen=p["ownerFrozen"], bank_frozen=p["bankFrozen"], policy_version=p["policyVersion"],
        )
        rest = out[len(fields):]
        for i, v in enumerate(vaults):
            allowed, quarantined, quarantined_at = rest[3 * i:3 * i + 3]
            state.allowed[v.lower()] = allowed
            state.quarantined[v.lower()] = quarantined
            state.quarantined_at[v.lower()] = quarantined_at
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

    def submit_deposit(self, key, dar, auth_sig, owner_sig, bank_sig, approval, gas: int | None = None) -> str:
        return self._send(key, self.addr.module, self._deposit_data(dar, auth_sig, owner_sig, bank_sig, approval),
                          gas=gas)

    def submit_redeem(self, key, dar, sig, gas: int | None = None) -> str:
        return self._send(key, self.addr.module, self.module.encode("redeem", dar.as_tuple(), _sig(sig)), gas=gas)

    def receipt(self, tx_hash: str) -> Receipt | None:
        rec = self._rpc("eth_getTransactionReceipt", [tx_hash])
        if rec is None:
            return None
        status = int(rec["status"], 16)
        block = int(rec["blockNumber"], 16)
        executed = []
        topic = "0x" + self.module.topic("AegisExecuted").hex()
        released = "0x" + self.escrow.topic("MilestoneReleased").hex()
        escrow = (self.addr.trade_escrow or "").lower()
        for log in rec.get("logs", []):
            if not log["topics"]:
                continue
            if log["address"].lower() == self.addr.module.lower() and log["topics"][0] == topic:
                executed.append(self._decode_executed(log))
            elif escrow and log["address"].lower() == escrow and log["topics"][0] == released:
                executed.append(self._decode_escrow(log))
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

    def _escrow_address(self) -> str:
        if not self.addr.trade_escrow:
            raise RuntimeError("TradeFlow is not configured: no tradeEscrow in the deployments file")
        return self.addr.trade_escrow

    def escrow_order(self, order_id: int) -> Order:
        return Order.from_tuple(int(order_id), self._view(self.escrow, self._escrow_address(), "getOrder",
                                                          int(order_id)))

    def escrow_milestones(self, order_id: int) -> list[tuple[MilestoneTerms, int]]:
        out = []
        for i in range(3):
            terms, status = self._view(self.escrow, self._escrow_address(), "getMilestone", int(order_id), i)
            out.append((MilestoneTerms.from_tuple(terms), int(status)))
        return out

    def escrow_committed_of(self, safe: str) -> int:
        return self._view(self.escrow, self._escrow_address(), "committedOf", to_checksum_address(safe))

    def escrow_used_nonce(self, buyer: str, nonce: int) -> bool:
        return self._view(self.escrow, self._escrow_address(), "usedNonce", to_checksum_address(buyer), nonce)

    def escrow_check_release(self, order_id, index, proof, auth) -> SimResult:
        try:
            ok, selector = self._view(self.escrow, self._escrow_address(), "checkRelease", int(order_id), index,
                                      proof.as_tuple(), auth.as_tuple())
        except CallReverted as e:
            return SimResult(False, e.reason)
        return SimResult(bool(ok), None if ok else error_name(selector))

    def _release_data(self, order_id, index, proof, issuer_sig, auth, auth_sig) -> bytes:
        return self.escrow.encode("release", int(order_id), index, proof.as_tuple(), _sig(issuer_sig),
                                  auth.as_tuple(), _sig(auth_sig))

    def sim_release(self, order_id, index, proof, issuer_sig, auth, auth_sig, sender) -> SimResult:
        try:
            self._eth_call(self._escrow_address(),
                           self._release_data(order_id, index, proof, issuer_sig, auth, auth_sig), sender=sender)
        except CallReverted as e:
            return SimResult(False, e.reason)
        return SimResult(True)

    def submit_release(self, key, order_id, index, proof, issuer_sig, auth, auth_sig, gas=None) -> str:
        return self._send(key, self._escrow_address(),
                          self._release_data(order_id, index, proof, issuer_sig, auth, auth_sig), gas=gas)

    def _decode_escrow(self, log: dict) -> dict:
        topics = [bytes.fromhex(t[2:]) for t in log["topics"]]
        data = bytes.fromhex(log["data"][2:])
        base = {"txHash": log["transactionHash"], "blockNumber": int(log["blockNumber"], 16),
                "logIndex": int(log["logIndex"], 16)}
        t0 = log["topics"][0]
        if t0 == "0x" + self.escrow.topic("OrderCreated").hex():
            d = self.escrow.decode_log("OrderCreated", topics, data)
            return {"event": "OrderCreated", "orderId": int(d["orderId"]), "buyer": to_checksum_address(d["buyer"]),
                    "supplier": to_checksum_address(d["supplier"]), "total": int(d["total"]),
                    "termsHash": hex32(d["termsHash"]), **base}
        if t0 == "0x" + self.escrow.topic("MilestoneReleased").hex():
            d = self.escrow.decode_log("MilestoneReleased", topics, data)
            return {"event": "MilestoneReleased", "orderId": int(d["orderId"]), "index": int(d["index"]),
                    "supplier": to_checksum_address(d["supplier"]), "amount": int(d["amount"]),
                    "proofHash": hex32(d["proofHash"]), "authHash": hex32(d["authHash"]), "waived": bool(d["waived"]),
                    **base}
        d = self.escrow.decode_log("OrderRefunded", topics, data)
        return {"event": "OrderRefunded", "orderId": int(d["orderId"]), "buyer": to_checksum_address(d["buyer"]),
                "amount": int(d["amount"]), **base}

    def escrow_events(self, from_block: int, to_block: int) -> list[dict]:
        topics0 = ["0x" + self.escrow.topic(e).hex() for e in ("OrderCreated", "MilestoneReleased", "OrderRefunded")]
        start = max(from_block, self.addr.trade_escrow_block)
        logs = []
        while start <= to_block:
            end = min(to_block, start + LOG_WINDOW - 1)
            logs.extend(self._rpc("eth_getLogs", [{"fromBlock": hex(start), "toBlock": hex(end),
                                                   "address": to_checksum_address(self._escrow_address()),
                                                   "topics": [topics0]}]))
            start = end + 1
        return [self._decode_escrow(log) for log in logs]

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
