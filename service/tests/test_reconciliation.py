"""Executed submissions always reach their request, whatever the order of the Executor and the API tick."""

from __future__ import annotations

import json
import threading

from aegis.eip712 import DAR, Approval
from aegis.ledger import reconcile


def mismatches(env) -> int:
    return reconcile(env.services.ledger, env.chain.events(env.safe), env.safe)["mismatches"]


def outcome(env, rid) -> tuple[str, str | None]:
    rec = env.wf.store.get(rid)
    return rec["state"], rec["data"].get("outcome")


def test_executor_confirming_before_submitted_move_still_applies(env):
    """The Executor can confirm while _finalize still explains SUBMITTED; that result must not be thrown away."""
    r = env.chat("deposit 2,000 USDC into vault B")
    explain = env.wf.agent.explain

    def racing_explain(facts, *args, **kwargs):
        if facts.get("outcome") == "SUBMITTED":
            worker = threading.Thread(target=env.settle)
            worker.start()
            worker.join()
            assert env.services.db.one("SELECT status FROM submissions")["status"] == "confirmed"
        return explain(facts, *args, **kwargs)

    env.wf.agent.explain = racing_explain
    r = env.approve(r)
    env.wf.agent.explain = explain
    assert r["state"] == "SUBMITTED"
    assert mismatches(env) == 1
    env.wf.apply_submission_results()
    assert outcome(env, r["requestId"]) == ("EXPLAINED", "CONFIRMED")
    assert env.wf.store.get(r["requestId"])["data"]["txHash"]
    assert mismatches(env) == 0


def test_result_marked_applied_by_an_earlier_tick_is_recovered(env):
    """The state the race above left on 84532: a confirmed submission marked applied, its request still SUBMITTED."""
    r = env.approve(env.chat("deposit 2,000 USDC into vault B"))
    env.rt.executor.tick()
    env.services.db.execute("UPDATE submissions SET applied=1")
    assert mismatches(env) == 1
    assert env.wf.apply_submission_results() == 1
    assert outcome(env, r["requestId"]) == ("EXPLAINED", "CONFIRMED")
    assert mismatches(env) == 0
    assert env.wf.apply_submission_results() == 0


def test_failing_apply_is_retried_and_does_not_block_others(env, monkeypatch):
    a = env.approve(env.chat("deposit 2,000 USDC into vault B"))
    b = env.approve(env.chat("deposit 500 USDC into vault B"))
    env.rt.executor.tick()
    finish = env.wf._finish
    calls = []

    def flaky(rec, *args, **kwargs):
        calls.append(rec["id"])
        if rec["id"] == a["requestId"] and calls.count(rec["id"]) == 1:
            raise RuntimeError("block range extends beyond current head block")
        return finish(rec, *args, **kwargs)

    monkeypatch.setattr(env.wf, "_finish", flaky)
    assert env.wf.apply_submission_results() == 1
    assert outcome(env, b["requestId"]) == ("EXPLAINED", "CONFIRMED")
    assert outcome(env, a["requestId"])[0] == "SUBMITTED"
    assert env.wf.apply_submission_results() == 1
    assert outcome(env, a["requestId"]) == ("EXPLAINED", "CONFIRMED")


def test_executed_dar_without_recorded_tx_is_confirmed_from_events(env):
    """The Executor broadcast the DAR but stopped before it stored the tx hash: the row stays 'claimed'."""
    r = env.approve(env.chat("deposit 2,000 USDC into vault B"))
    sub = env.services.db.one("SELECT * FROM submissions")
    sigs = json.loads(sub["sigs"])
    tx = env.chain.submit_deposit("k", DAR.from_json(json.loads(sub["dar"])), sigs["auth"], sigs["owner"],
                                  sigs.get("bank") or "", Approval.from_json(json.loads(sub["approval"])))
    env.services.db.execute("UPDATE submissions SET status='claimed', claimed_by='executor'")
    assert env.wf.reconcile_onchain() == 0
    assert env.wf.reconcile_onchain(older_than=0) == 1
    env.wf.apply_submission_results()
    rec = env.wf.store.get(r["requestId"])
    assert (rec["state"], rec["data"]["outcome"], rec["data"]["txHash"]) == ("EXPLAINED", "CONFIRMED", tx)
    assert mismatches(env) == 0
    assert env.rt.executor.tick() == 0


def test_background_tick_continues_after_a_failing_step(env, monkeypatch):
    from aegis.chain.rpc import RpcError

    def lagging():
        raise RpcError(-32602, "block range extends beyond current head block: requested 11, head 10")

    ran = []
    monkeypatch.setattr(env.rt.tradeflow, "tick", lagging)
    monkeypatch.setattr(env.rt, "tail_events", lambda: ran.append("tail"))
    monkeypatch.setattr(env.wf, "expire_approvals", lambda: ran.append("expire"))
    env.rt.tick()
    assert ran == ["tail", "expire"]


def test_diagnostic_script_reads_the_stuck_state_without_writing(env):
    import importlib.util
    import time
    from pathlib import Path

    path = Path(__file__).resolve().parents[1] / "scripts" / "diagnose_submission.py"
    spec = importlib.util.spec_from_file_location("diagnose_submission", path)
    diag = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(diag)

    env.approve(env.chat("deposit 2,000 USDC into vault B"))
    env.rt.executor.tick()
    env.services.db.execute("UPDATE submissions SET applied=1")
    dar_hash = env.services.db.one("SELECT dar_hash FROM submissions")["dar_hash"]
    sub, request = diag.read_db(env.settings.db_path, dar_hash.upper().replace("0X", "0x"))
    assert diag.verdict(sub, request, True, time.time()).startswith("RECOVERS on the next tick")
    env.services.db.execute("UPDATE submissions SET status='claimed', tx_hash=NULL, created_at=?", (time.time(),))
    sub, request = diag.read_db(env.settings.db_path, dar_hash)
    assert diag.verdict(sub, request, True, time.time()).startswith("RECOVERS in about")
    assert diag.verdict(sub, request, False, time.time()).startswith("waiting")


def test_send_error_after_broadcast_is_confirmed_not_reverted(env):
    """eth_sendRawTransaction timed out but the node had taken the transaction: the row says 'failed'."""
    r = env.approve(env.chat("deposit 2,000 USDC into vault B"))
    sub = env.services.db.one("SELECT * FROM submissions")
    sigs = json.loads(sub["sigs"])
    tx = env.chain.submit_deposit("k", DAR.from_json(json.loads(sub["dar"])), sigs["auth"], sigs["owner"],
                                  sigs.get("bank") or "", Approval.from_json(json.loads(sub["approval"])))
    env.services.db.execute("UPDATE submissions SET status='failed', error='send failed: ReadTimeout'")
    assert env.wf.apply_submission_results() == 0
    assert outcome(env, r["requestId"])[0] == "SUBMITTED"
    assert env.wf.reconcile_onchain(older_than=0) == 1
    env.wf.apply_submission_results()
    rec = env.wf.store.get(r["requestId"])
    assert (rec["data"]["outcome"], rec["data"]["txHash"]) == ("CONFIRMED", tx)
    assert mismatches(env) == 0


def test_preflight_failure_still_reverts(env):
    r = env.approve(env.chat("deposit 2,000 USDC into vault B"))
    env.services.db.execute("UPDATE submissions SET status='failed', error='ReserveFloorBreached'")
    assert env.wf.apply_submission_results() == 1
    assert outcome(env, r["requestId"]) == ("EXPLAINED", "REVERTED")
