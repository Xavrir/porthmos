from __future__ import annotations

import json

import httpx
import pytest

from aegis.chain.rpc import CallReverted, RpcChain, RpcError
from aegis.config import load_settings
from aegis.core.state import load_state

HEAD = 0x2A
ADDR = "0x" + "11" * 20
NAME = "0x06fdde03"
EMPTY_STRING = "0x" + "20".rjust(64, "0") + "0" * 64


class Node:
    """JSON-RPC stub: eth_call echoes its calldata as a uint256, so each reply shows which call it answers."""

    def __init__(self, batches: bool = True, revert: bytes | None = None, zeros: bool = False):
        self.batches = batches
        self.zeros = zeros
        self.revert = revert
        self.posts: list = []

    def reply(self, req: dict) -> dict:
        if req["method"] == "eth_getBlockByNumber":
            return {"jsonrpc": "2.0", "id": req["id"], "result": {"number": hex(HEAD), "timestamp": hex(1_700_000_000)}}
        data = req["params"][0]["data"]
        if self.revert is not None and data == "0x" + self.revert.hex():
            return {"jsonrpc": "2.0", "id": req["id"], "error": {"code": 3, "message": "execution reverted",
                                                                  "data": "0x08c379a0"}}
        if self.zeros:
            return {"jsonrpc": "2.0", "id": req["id"], "result": EMPTY_STRING if data == NAME else "0x" + "0" * 320}
        return {"jsonrpc": "2.0", "id": req["id"], "result": "0x" + data[2:].rjust(320, "0")}

    def __call__(self, request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        self.posts.append(body)
        if isinstance(body, list):
            if not self.batches:
                return httpx.Response(400, json={"jsonrpc": "2.0", "id": None,
                                                 "error": {"code": -32600, "message": "batch not supported"}})
            return httpx.Response(200, json=[self.reply(r) for r in reversed(body)])
        return httpx.Response(200, json=self.reply(body))

    def calls(self) -> list[dict]:
        flat = [r for p in self.posts for r in (p if isinstance(p, list) else [p])]
        return [r for r in flat if r["method"] == "eth_call"]


def make_chain(node: Node) -> RpcChain:
    chain = RpcChain(load_settings(chain_mode="rpc", chain_id=84532))
    chain._http = httpx.Client(transport=httpx.MockTransport(node))
    return chain


def echo(chain: RpcChain, n: int):
    return lambda: int.from_bytes(chain._eth_call(ADDR, bytes([n])), "big")


def test_gather_sends_one_batch_and_keeps_order():
    node = Node()
    chain = make_chain(node)
    assert chain.gather([echo(chain, n) for n in range(1, 13)]) == list(range(1, 13))
    assert len(node.posts) == 1 and len(node.posts[0]) == 12


def test_nested_gather_costs_one_round_trip_per_stage():
    node = Node()
    chain = make_chain(node)

    def staged(n):
        first = chain.gather([echo(chain, n), echo(chain, n + 100)])
        return first, echo(chain, sum(first) % 256)()

    out = chain.gather([lambda n=n: staged(n) for n in (1, 2, 3)] + [echo(chain, 9)])
    assert out == [([1, 101], 102), ([2, 102], 104), ([3, 103], 106), 9]
    assert [len(p) for p in node.posts] == [7, 3]


def test_pinned_reads_use_one_block_tag():
    node = Node()
    chain = make_chain(node)
    pinned = chain.at_block(HEAD)
    pinned.gather([echo(pinned, n) for n in range(5)])
    echo(chain, 1)()
    tags = [c["params"][1] for c in node.calls()]
    assert tags == [hex(HEAD)] * 5 + ["latest"]


def test_rejected_batch_falls_back_to_single_calls():
    node = Node(batches=False)
    chain = make_chain(node)
    assert chain.gather([echo(chain, n) for n in range(1, 5)]) == [1, 2, 3, 4]
    assert isinstance(node.posts[0], list) and all(isinstance(p, dict) for p in node.posts[1:])
    node.posts.clear()
    pinned = chain.at_block(HEAD)
    assert pinned.gather([echo(pinned, n) for n in range(1, 4)]) == [1, 2, 3]
    assert all(isinstance(p, dict) for p in node.posts)


def test_revert_in_batch_reaches_only_its_caller():
    node = Node(revert=bytes([7]))
    chain = make_chain(node)

    def guarded():
        try:
            return echo(chain, 7)()
        except CallReverted:
            return "reverted"

    assert chain.gather([echo(chain, 1), guarded, echo(chain, 3)]) == [1, "reverted", 3]
    with pytest.raises(CallReverted):
        chain.gather([echo(chain, 1), echo(chain, 7)])


def test_load_state_reads_one_block_in_two_round_trips():
    node = Node(zeros=True)
    chain = make_chain(node)
    state = load_state(chain, chain.settings, ADDR)
    assert state.block == HEAD and state.timestamp == 1_700_000_000
    assert len(node.posts) == 2 and node.posts[0]["method"] == "eth_getBlockByNumber"
    assert isinstance(node.posts[1], list)
    assert {c["params"][1] for c in node.calls()} == {hex(HEAD)}


def test_back_to_back_sends_do_not_reuse_a_stale_pending_nonce():
    sent = []

    def node(request: httpx.Request) -> httpx.Response:
        req = json.loads(request.content)
        result = {"eth_getTransactionCount": "0x5", "eth_maxPriorityFeePerGas": "0x1",
                  "eth_getBlockByNumber": {"number": hex(HEAD), "baseFeePerGas": "0x1"}}.get(req["method"])
        if req["method"] == "eth_sendRawTransaction":
            sent.append(req["params"][0])
            result = "0x" + f"{len(sent):064x}"
        return httpx.Response(200, json={"jsonrpc": "2.0", "id": req["id"], "result": result})

    chain = RpcChain(load_settings(chain_mode="rpc", chain_id=84532))
    chain._http = httpx.Client(transport=httpx.MockTransport(node))
    key = "0x" + "42" * 32
    chain.send_value(key, ADDR, 1)
    chain.send_value(key, "0x" + "22" * 20, 1)
    import rlp

    nonces = [int.from_bytes(rlp.decode(bytes.fromhex(raw[4:]))[1] or b"\0", "big") for raw in sent]
    assert nonces == [5, 6]


class LaggingNode:
    """Answers eth_blockNumber from the newest node and every other call from one `lag` blocks behind it."""

    def __init__(self, head: int, lag: int, catch_up_after: int | None = None):
        self.head, self.lag, self.catch_up_after = head, lag, catch_up_after
        self.ranges: list[tuple[int, int]] = []
        self.refusals = 0

    def __call__(self, request: httpx.Request) -> httpx.Response:
        req = json.loads(request.content)
        if req["method"] == "eth_blockNumber":
            return httpx.Response(200, json={"jsonrpc": "2.0", "id": req["id"], "result": hex(self.head)})
        behind = self.head - (0 if self.catch_up_after is not None and self.refusals >= self.catch_up_after
                              else self.lag)
        if req["method"] == "eth_getLogs":
            lo, hi = (int(req["params"][0][k], 16) for k in ("fromBlock", "toBlock"))
            if hi > behind:
                self.refusals += 1
                return httpx.Response(200, json={"jsonrpc": "2.0", "id": req["id"], "error": {
                    "code": -32602,
                    "message": f"block range extends beyond current head block: requested {hi}, head {behind}"}})
            self.ranges.append((lo, hi))
            return httpx.Response(200, json={"jsonrpc": "2.0", "id": req["id"], "result": []})
        if int(req["params"][1], 16) > behind:
            self.refusals += 1
            return httpx.Response(200, json={"jsonrpc": "2.0", "id": req["id"], "error": {
                "code": -32001, "message": f"block not found: {req['params'][1]}"}})
        return httpx.Response(200, json={"jsonrpc": "2.0", "id": req["id"], "result": "0x" + "0" * 63 + "7"})


@pytest.fixture
def no_sleep(monkeypatch):
    import aegis.chain.rpc as rpc

    monkeypatch.setattr(rpc.time, "sleep", lambda s: None)


def lagging_chain(node: LaggingNode) -> RpcChain:
    chain = RpcChain(load_settings(chain_mode="rpc", chain_id=84532))
    chain._http = httpx.Client(transport=httpx.MockTransport(node))
    chain.addr.deploy_block = node.head - 100
    return chain


def test_event_snapshot_stops_at_the_head_the_log_node_reports(no_sleep):
    node = LaggingNode(head=48266380, lag=1)
    chain = lagging_chain(node)
    assert chain.events(ADDR) == []
    assert node.ranges == [(48266280, 48266379)]


def test_escrow_scan_waits_for_the_lagging_node_instead_of_skipping_blocks(no_sleep):
    node = LaggingNode(head=48266380, lag=1, catch_up_after=2)
    chain = lagging_chain(node)
    chain.addr.trade_escrow_block = node.head - 10
    assert chain.escrow_events(node.head, node.head) == []
    assert node.ranges == [(48266380, 48266380)]
    stuck = LaggingNode(head=48266380, lag=1)
    chain = lagging_chain(stuck)
    chain.addr.trade_escrow_block = stuck.head - 10
    with pytest.raises(RpcError):
        chain.escrow_events(stuck.head, stuck.head)


def test_pinned_read_retries_on_a_node_that_has_not_seen_the_block(no_sleep):
    node = LaggingNode(head=HEAD, lag=1, catch_up_after=1)
    chain = lagging_chain(node).at_block(HEAD)
    assert int.from_bytes(chain._eth_call(ADDR, b"\x01"), "big") == 7
    assert node.refusals == 1


class NonceNode:
    def __init__(self, pending: int):
        self.pending = pending

    def __call__(self, request: httpx.Request) -> httpx.Response:
        req = json.loads(request.content)
        result = {"eth_getTransactionCount": lambda: hex(self.pending),
                  "eth_getBlockByNumber": lambda: {"number": hex(HEAD), "timestamp": "0x1", "baseFeePerGas": "0x1"},
                  "eth_maxPriorityFeePerGas": lambda: "0x1",
                  "evm_revert": lambda: True}.get(req["method"])
        if req["method"] == "eth_sendRawTransaction":
            return httpx.Response(200, json={"jsonrpc": "2.0", "id": req["id"], "result": "0x" + "ab" * 32})
        return httpx.Response(200, json={"jsonrpc": "2.0", "id": req["id"], "result": result()})


def test_remembered_nonce_covers_a_lagging_node_but_not_a_revert_or_a_dropped_tx(monkeypatch):
    import aegis.chain.rpc as rpc
    from eth_account import Account

    node = NonceNode(pending=5)
    chain = make_chain(node)
    key = Account.create().key.hex()
    nonces = []
    original = rpc.Account.sign_transaction
    monkeypatch.setattr(rpc.Account, "sign_transaction",
                        staticmethod(lambda tx, k: nonces.append(tx["nonce"]) or original(tx, k)))
    chain.send_value(key, ADDR, 1)
    chain.send_value(key, ADDR, 1)
    chain._rpc("evm_revert", ["0x1"])
    chain.send_value(key, ADDR, 1)
    now = rpc.time.monotonic()
    monkeypatch.setattr(rpc.time, "monotonic", lambda: now + rpc.NONCE_MEMORY + 1)
    chain.send_value(key, ADDR, 1)
    assert nonces == [5, 6, 5, 5]
