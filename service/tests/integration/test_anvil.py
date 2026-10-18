"""End-to-end against Anvil + deployments/31337.json (run: RPC_URL=... uv run pytest -m integration).

The chain is snapshotted before and reverted after, so a shared Anvil is left as it was.
"""

from __future__ import annotations

import httpx
import pytest

from aegis.chain.fake import addr_of
from aegis.chain.rpc import RpcChain
from aegis.config import ANVIL_KEYS, PRICE_ONE, UINT256_MAX, USDC, load_key, load_settings
from aegis.eip712 import Approval, DAR, sign_approval_typed
from aegis.ledger import reconcile
from aegis.runtime import Runtime
from aegis.workflow import Session

pytestmark = pytest.mark.integration


def _reachable(url: str) -> bool:
    try:
        httpx.post(url, json={"jsonrpc": "2.0", "id": 1, "method": "eth_chainId", "params": []}, timeout=2)
        return True
    except httpx.HTTPError:
        return False


@pytest.fixture(scope="module")
def live(tmp_path_factory):
    settings = load_settings(chain_mode="rpc")
    if not settings.addresses.safes:
        pytest.skip("deployments/31337.json not found")
    if not _reachable(settings.rpc_url):
        pytest.skip(f"no RPC at {settings.rpc_url}")
    settings.db_path = str(tmp_path_factory.mktemp("live") / "aegis.db")
    settings.in_process_workers = True
    settings.demo_mode = True
    chain = RpcChain(settings)
    safe = settings.addresses.safes[0]
    pol = chain.policy(safe, [v.address for v in settings.addresses.vaults])
    if chain.usdc_balance(safe) != 10_000 * USDC or any(pol.quarantined.values()) or pol.owner_frozen \
            or pol.bank_frozen:
        pytest.skip("chain is not in the fresh Deploy.s.sol state; restart Anvil and redeploy")
    snap_id = chain._rpc("evm_snapshot", [])
    chain.wait_receipt(chain.poke(load_key("keeper", 31337)))
    rt = Runtime.build(settings, chain=chain)
    ctx = type("Live", (), {})()
    ctx.rt, ctx.chain, ctx.settings, ctx.safe = rt, chain, settings, settings.addresses.safes[0]
    ctx.va, ctx.vb = (v.address for v in settings.addresses.vaults)
    ctx.owner = Session("live-owner", "owner", addr_of("owner"), ctx.safe)
    yield ctx
    chain._rpc("evm_revert", [snap_id])


def fresh_oracle(live):
    live.chain.wait_receipt(live.chain.poke(load_key("keeper", 31337)))


def approve(live, resp):
    msg = resp["actionCard"]["approvalTypedData"]["message"]
    sig = sign_approval_typed(ANVIL_KEYS["owner"], 31337, live.settings.addresses.module, Approval.from_json(msg))
    return live.rt.workflow.approve(live.owner, resp["requestId"], sig, msg)


def settle(live):
    live.rt.executor.tick()
    live.rt.workflow.apply_submission_results()
    live.rt.exit_agent.track()


def outcome(live, rid):
    return live.rt.workflow.store.get(rid)["data"].get("outcome")


def test_reads_match_deployment(live):
    snap = live.rt.services.snapshot(live.safe)
    p = snap.state.policy
    assert p.owner == addr_of("owner") and p.bank == addr_of("bank") and p.authorizer == addr_of("authorizer")
    assert p.auto_cap == 1000 * USDC and p.bank_limit == 3000 * USDC and p.reserve_floor == 4500 * USDC
    assert snap.state.safe_usdc == 10_000 * USDC
    assert snap.plan.in_sync and snap.plan.default_id == "deposit-vault-b"


def test_t3_deposit_executes_on_chain(live):
    fresh_oracle(live)
    r = live.rt.workflow.chat(live.owner, "deposit 2,000 USDC into vault B")
    assert r["state"] == "AWAITING_APPROVAL" and r["actionCard"]["tier"] == 3
    assert approve(live, r)["state"] == "SUBMITTED"
    settle(live)
    rec = live.rt.workflow.store.get(r["requestId"])
    assert rec["data"]["outcome"] == "CONFIRMED", rec["data"].get("reason")
    events = live.chain.events(live.safe)
    ex = [e for e in events if e["event"] == "AegisExecuted"]
    assert ex[-1]["darHash"] == rec["data"]["darHash"] and ex[-1]["assets"] == 2000 * USDC and ex[-1]["tier"] == 3


def test_t2_routine_deposit(live):
    fresh_oracle(live)
    r = live.rt.workflow.chat(live.owner, "deposit 500 USDC into vault B")
    assert r["state"] == "SUBMITTED" and r["actionCard"]["tier"] == 2
    settle(live)
    assert outcome(live, r["requestId"]) == "CONFIRMED"


def test_executed_dar_with_lost_tx_hash_is_reconciled_from_logs(live):
    """The Executor broadcast the DAR, then died before recording the tx hash; the chain still tells the outcome."""
    fresh_oracle(live)
    r = live.rt.workflow.chat(live.owner, "deposit 300 USDC into vault B")
    assert r["state"] == "SUBMITTED"
    live.rt.executor.tick()
    db = live.rt.services.db
    sub = db.one("SELECT * FROM submissions WHERE request_id=?", (r["requestId"],))
    assert sub["status"] == "confirmed"
    db.execute("UPDATE submissions SET status='claimed', tx_hash=NULL, result=NULL, applied=0 WHERE id=?", (sub["id"],))
    assert live.rt.workflow.apply_submission_results() == 0
    assert live.rt.workflow.reconcile_onchain(older_than=0) == 1
    assert live.rt.workflow.apply_submission_results() == 1
    rec = live.rt.workflow.store.get(r["requestId"])
    assert (rec["state"], rec["data"]["outcome"], rec["data"]["txHash"]) == ("EXPLAINED", "CONFIRMED", sub["tx_hash"])
    assert reconcile(live.rt.services.ledger, live.chain.events(live.safe), live.safe)["mismatches"] == 0


def test_tampered_and_replayed_dars_revert(live):
    import json

    rec = next(x for x in reversed(live.rt.services.ledger.rows()) if x["kind"] == "DAR_SIGNED")
    sub = live.rt.services.db.one("SELECT * FROM submissions WHERE dar_hash=?", (rec["dar_hash"],))
    dar = DAR.from_json(json.loads(sub["dar"]))
    sigs = json.loads(sub["sigs"])
    approval = Approval.from_json(json.loads(sub["approval"])) if sub["approval"] else Approval.empty()
    replay = live.chain.sim_deposit_submission(dar, sigs["auth"], sigs.get("owner") or "", sigs.get("bank") or "",
                                               approval, addr_of("attacker"))
    assert not replay.ok and replay.error == "NonceUsed"
    dar.amount += 1
    tampered = live.chain.sim_deposit_submission(dar, sigs["auth"], sigs.get("owner") or "", sigs.get("bank") or "",
                                                 approval, addr_of("attacker"))
    assert not tampered.ok and tampered.error == "BadSignature"


def test_partial_exit_and_self_submit_a8_a9(live):
    fresh_oracle(live)
    r = live.rt.workflow.chat(live.owner, "deposit 1,500 USDC into vault A")
    approve(live, r)
    settle(live)
    assert outcome(live, r["requestId"]) == "CONFIRMED"
    shares = live.chain.shares_of(live.va, live.safe)
    admin = load_key("admin", 31337)
    live.chain.wait_receipt(live.chain.admin_set_liquidity_cap(admin, live.va, live.chain.convert_to_assets(
        live.va, shares) // 2))
    rep = live.rt.exit_agent.tick(force=True)
    assert any(a["action"] == "exit" and a["partial"] for a in rep["actions"])
    for _ in range(3):
        live.chain._rpc("evm_mine", [])
    assert live.rt.exit_agent.tick()["fallback"] == 1
    sub = live.rt.services.db.one("SELECT * FROM submissions WHERE source='exit_agent' ORDER BY id DESC LIMIT 1")
    assert sub["status"] == "confirmed" and sub["claimed_by"] == "exit_agent"
    left = live.chain.shares_of(live.va, live.safe)
    assert 0 < left < shares
    rep = live.rt.exit_agent.tick(force=True)
    assert any(a["action"] == "blocked" for a in rep["actions"])
    live.chain.wait_receipt(live.chain.admin_set_liquidity_cap(admin, live.va, UINT256_MAX))
    live.rt.exit_agent.tick(force=True)
    settle(live)
    assert live.chain.shares_of(live.va, live.safe) == 0


def test_depeg_exit_and_deposits_held(live):
    admin = load_key("admin", 31337)
    live.chain.wait_receipt(live.chain.admin_set_price(admin, 98_500_000))
    rep = live.rt.exit_agent.tick(force=True)
    assert any(a["action"] == "quarantine" and a["ok"] for a in rep["actions"])
    settle(live)
    assert live.chain.shares_of(live.vb, live.safe) == 0
    assert any(e["event"] == "Quarantined" for e in live.chain.events(live.safe))
    r = live.rt.workflow.chat(live.owner, "deposit 500 USDC into vault B")
    assert r["state"] == "EXPLAINED" and "actionCard" not in r
    live.chain.wait_receipt(live.chain.admin_set_price(admin, PRICE_ONE))


def test_ledger_reconciles_with_chain(live):
    rep = reconcile(live.rt.services.ledger, live.chain.events(live.safe), live.safe)
    assert rep["mismatches"] == 0, rep["details"]
    assert rep["chainExecutions"] >= 5
