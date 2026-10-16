"""TradeFlow on Anvil with the real TradeEscrow (TECHNICAL-DOCUMENT 05, T43 and T39; E6 dry run).

Each test runs on its own EVM snapshot and its own service database: the order is funded by the owner key through
Safe + MultiSendCallOnly, proofs go through the Proof Verifier, the Authorizer and the Executor, and the chain is
reverted afterwards.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from eth_account import Account
from eth_utils import keccak, to_checksum_address
from fastapi.testclient import TestClient

from aegis.api.app import create_app
from aegis.chain import safe as safe_lib
from aegis.chain.abi import Contract
from aegis.chain.fake import addr_of
from aegis.chain.rpc import RpcChain
from aegis.config import ANVIL_KEYS, USDC, load_key, load_settings
from aegis.eip712 import random_nonce, sign_digest
from aegis.runtime import Runtime
from aegis.tradeflow.typed import (
    MilestoneProof,
    MilestoneTerms,
    ReleaseAuthorization,
    auth_digest,
    proof_struct_hash,
)
from aegis.workflow import Session
from tests.integration.test_anvil import _reachable

pytestmark = pytest.mark.integration

REGISTRY = Contract("PolicyRegistry")
ESCROW = Contract("TradeEscrow")
SERVICE = Path(__file__).resolve().parents[2]
DAY = 86400


@pytest.fixture(scope="module")
def base():
    settings = load_settings(chain_mode="rpc")
    if not settings.addresses.safes:
        pytest.skip("deployments/31337.json not found")
    if not _reachable(settings.rpc_url):
        pytest.skip(f"no RPC at {settings.rpc_url}")
    if not settings.tradeflow_enabled:
        pytest.skip("deployments/31337.json has no tradeEscrow (run make deploy)")
    chain = RpcChain(settings)
    if not chain.code_size(settings.addresses.trade_escrow):
        pytest.skip("no TradeEscrow code at the deployed address")
    return settings, chain


@pytest.fixture
def live(base, tmp_path):
    settings, chain = base
    snap = chain._rpc("evm_snapshot", [])
    settings.db_path = str(tmp_path / "aegis.db")
    settings.in_process_workers = True
    settings.demo_mode = True
    chain.wait_receipt(chain.poke(load_key("keeper", 31337)))
    rt = Runtime.build(settings, chain=chain)
    safe = settings.addresses.safes[0]
    ctx = SimpleNamespace(rt=rt, chain=chain, settings=settings, safe=safe, tf=rt.tradeflow,
                          owner=Session("live-owner", "owner", addr_of("owner"), safe))
    try:
        yield ctx
    finally:
        chain._rpc("evm_revert", [snap])


def send(live, key: str, to: str, data: bytes) -> str:
    tx = live.chain.send(key, to, data)
    rec = live.chain.wait_receipt(tx)
    assert rec is not None and rec.status == 1, (tx, rec)
    return tx


def terms_for(live, issuers=None) -> list[MilestoneTerms]:
    iss = issuers or live.settings.addresses.issuers
    now = live.chain.head_timestamp()
    return [MilestoneTerms(200 * USDC, iss["carrier"], 0, True, False, 0, 0, now + 7 * DAY),
            MilestoneTerms(400 * USDC, iss["sensor"], 1, True, True, 200, 800, now + 21 * DAY),
            MilestoneTerms(400 * USDC, iss["surveyor"], 2, True, False, 0, 0, now + 30 * DAY)]


def fund_order(live, safe: str | None = None, owner_key: str = ANVIL_KEYS["owner"], terms=None) -> tuple[int, str]:
    """The owner's single Safe transaction: delegatecall to MultiSendCallOnly with approve + createOrder."""
    a = live.settings.addresses
    safe = safe or live.safe
    terms = terms or terms_for(live)
    supplier = Account.create().address
    total = sum(t.amount for t in terms)
    data = safe_lib.fund_order_exec_data(safe, Account.from_key(owner_key).address, a.multi_send_call_only, a.usdc,
                                         a.trade_escrow, supplier, total, keccak(text="PO-2026-001"), terms)
    tx = send(live, owner_key, safe, data)
    raw = live.chain._rpc("eth_getTransactionReceipt", [tx])
    created = [log for log in raw["logs"] if log["address"].lower() == a.trade_escrow.lower()]
    order_id = int(created[0]["topics"][1], 16)
    allowance = live.chain._view(live.chain.usdc, a.usdc, "allowance", to_checksum_address(safe),
                                 to_checksum_address(a.trade_escrow))
    assert allowance == 0
    live.tf.sync_chain()
    return order_id, supplier


def settle(live, rounds: int = 1) -> None:
    for _ in range(rounds):
        live.rt.executor.tick()
        live.rt.tradeflow.tick()


def st(live, oid, idx):
    m = live.tf.milestone(oid, idx)
    return m["state"], m["reason"]


def registry_tx(live, key: str, fn: str, *args) -> str:
    return send(live, key, live.settings.addresses.registry, REGISTRY.encode(fn, to_checksum_address(live.safe),
                                                                              *args))


def test_happy_path_three_releases_through_the_pipeline(live):
    oid, supplier = fund_order(live)
    order = live.chain.escrow_order(oid)
    assert order.active and live.chain.escrow_committed_of(live.safe) == 1000 * USDC
    kinds_before = [r["kind"] for r in live.rt.services.ledger.rows(live.safe)]
    assert "ORDER_CREATED" in kinds_before
    for i in range(3):
        r = live.tf.demo_proof(live.owner, oid, i, "valid")
        assert r["state"] == "RELEASE_SIGNED", r
        settle(live)
        assert st(live, oid, i) == ("RELEASED", None)
    assert live.chain.usdc_balance(supplier) == 1000 * USDC
    assert live.chain.escrow_order(oid).status == 2 and live.chain.escrow_committed_of(live.safe) == 0
    view = live.tf.full_view(oid)
    for m in view["milestones"]:
        assert [h["to"] for h in m["history"]][-3:] == ["RELEASE_SIGNED", "RELEASE_SUBMITTED", "RELEASED"]
        tx = live.chain._rpc("eth_getTransactionByHash", [m["ledgerRef"][-1]["txHash"]])
        assert tx["from"].lower() == addr_of("executor").lower()
    assert view["order"]["status"] == "COMPLETED"
    t = live.rt.services.snapshot(live.safe)
    assert t.state.safe_usdc == 9_000 * USDC
    events = live.chain.escrow_events(0, live.chain.block_number())
    assert live.tf.reconcile(live.safe, events)["mismatches"] == 0


def test_contract_check_release_agrees_with_the_verifier(live):
    oid, _ = fund_order(live)
    live.tf.demo_proof(live.owner, oid, 0, "valid")
    settle(live)
    order, ms = live.chain.escrow_order(oid), live.chain.escrow_milestones(oid)
    terms = ms[1][0]
    now = live.chain.head_timestamp()
    pol = live.chain.policy(live.safe, [])
    corpus = {"valid": ({}, None), "outOfRange": ({"maxTempCenti": 940}, "ConditionNotMet"),
              "zeroSamples": ({"samples": 0}, "ConditionNotMet"), "noDoc": ({"docHash": b"\0" * 32},
                                                                          "ConditionNotMet"),
              "early": ({"issuedAt": order.createdAt - 1}, "BadProofTime"),
              "future": ({"issuedAt": now + 3600}, "BadProofTime")}
    for case, (overrides, expected) in corpus.items():
        fields = dict(orderId=oid, index=1, kind=1, docHash=keccak(b"log"), minTempCenti=300, maxTempCenti=700,
                      samples=12, issuedAt=now)
        fields.update(overrides)
        proof = MilestoneProof(**fields)
        auth = ReleaseAuthorization(oid, 1, terms.amount, proof_struct_hash(proof), pol.policy_version,
                                    random_nonce(), now + 120)
        onchain = live.chain.escrow_check_release(oid, 1, proof, auth)
        verdict = live.tf.verifier.evaluate(order, terms, proof)
        assert (onchain.error if not onchain.ok else None) == expected == verdict.reason, case


def test_hold_on_out_of_range_temperature_then_forced_submit_reverts(live):
    oid, supplier = fund_order(live)
    live.tf.demo_proof(live.owner, oid, 0, "valid")
    settle(live)
    r = live.tf.demo_proof(live.owner, oid, 1, "outOfRange")
    assert (r["state"], r["reason"]) == ("HELD", "ConditionNotMet")
    subs = live.rt.services.db.query("SELECT * FROM submissions WHERE source='release'")
    assert len(subs) == 1
    held = live.tf.full_view(oid)["milestones"][1]
    proof = MilestoneProof.from_json(held["proof"]["proof"])
    pol = live.chain.policy(live.safe, [])
    auth = ReleaseAuthorization(oid, 1, 400 * USDC, proof_struct_hash(proof), pol.policy_version, random_nonce(),
                                live.chain.head_timestamp() + 120)
    auth_sig = sign_digest(ANVIL_KEYS["authorizer"], auth_digest(31337, live.settings.addresses.trade_escrow, auth))
    tx = live.chain.submit_release(ANVIL_KEYS["attacker"], oid, 1, proof, held["proof"]["issuerSignature"], auth,
                                   auth_sig, gas=800_000)
    rec = live.chain.wait_receipt(tx)
    assert rec.status == 0 and rec.revert_reason == "ConditionNotMet"
    waive = ESCROW.encode("waive", oid, 1)
    send(live, ANVIL_KEYS["owner"], live.safe, safe_lib.owner_call_exec_data(live.settings.addresses.trade_escrow,
                                                                              waive, addr_of("owner")))
    live.tf.tick()
    assert st(live, oid, 1)[0] == "WAIVED" and live.chain.usdc_balance(supplier) == 600 * USDC


def test_waiting_during_bank_freeze_then_release_after_unfreeze(live):
    oid, supplier = fund_order(live)
    registry_tx(live, ANVIL_KEYS["bank"], "bankFreeze")
    r = live.tf.demo_proof(live.owner, oid, 0, "valid")
    assert (r["state"], r["reason"]) == ("WAITING", "Frozen")
    settle(live)
    assert st(live, oid, 0) == ("WAITING", "Frozen")
    registry_tx(live, ANVIL_KEYS["bank"], "bankUnfreeze")
    settle(live, 2)
    assert st(live, oid, 0)[0] == "RELEASED" and live.chain.usdc_balance(supplier) == 200 * USDC


def test_authorizer_not_current_waits_until_restored(live):
    oid, supplier = fund_order(live)
    registry_tx(live, ANVIL_KEYS["owner"], "revokeAuthorizer")
    assert live.chain.policy(live.safe, []).authorizer.lower() != addr_of("authorizer").lower()
    r = live.tf.demo_proof(live.owner, oid, 0, "valid")
    assert (r["state"], r["reason"]) == ("WAITING", "AuthorizerNotCurrent")
    assert live.rt.authorizer.db.one("SELECT COUNT(*) AS n FROM signed_releases")["n"] == 0
    registry_tx(live, ANVIL_KEYS["owner"], "setAuthorizer", to_checksum_address(addr_of("authorizer")))
    settle(live, 2)
    assert st(live, oid, 0)[0] == "RELEASED" and live.chain.usdc_balance(supplier) == 200 * USDC


def test_tenant_isolation_for_orders(live):
    from tests.integration.test_multitenant_anvil import login, onboard_exactly

    with TestClient(create_app(live.rt, start_background=False)) as client:
        ctx = SimpleNamespace(rt=live.rt, chain=live.chain, settings=live.settings, client=client,
                              config=client.get("/api/onboard/config").json())
        b = onboard_exactly(ctx)
        oid, _ = fund_order(live)
        oid_b, _ = fund_order(live, safe=b.safe, owner_key=b.owner.key)
        assert oid_b != oid
        live.tf.demo_proof(live.owner, oid, 0, "outOfRange")
        ha, hb, hbank_b = login(ctx, Account.from_key(ANVIL_KEYS["owner"]), "owner"), login(ctx, b.owner, "owner"), \
            login(ctx, b.bank, "bank")
        assert [o["order"]["orderId"] for o in client.get("/api/tradeflow/orders", headers=ha).json()["orders"]] == [
            str(oid)]
        for h in (hb, hbank_b):
            assert [o["order"]["orderId"] for o in client.get("/api/tradeflow/orders", headers=h).json()["orders"]] \
                == [str(oid_b)]
            client.cookies.clear()
            v = client.get(f"/api/tradeflow/orders/{oid}", headers=h).json()
            assert v["view"] == "public" and "state" not in v["milestones"][0] and "ledgerRef" not in v["milestones"][0]
        assert client.post(f"/api/tradeflow/orders/{oid}/proofs/demo", json={"index": 1}, headers=hb).status_code \
            == 404
        client.cookies.clear()
        assert client.get(f"/api/tradeflow/orders/{oid}").json()["view"] == "public"
        assert client.get(f"/api/tradeflow/orders/{oid}", headers=ha).json()["milestones"][0]["state"] == "HELD"


def test_e6_dry_run_on_anvil(base, tmp_path):
    """The evidence script's E6 phase against Anvil (--chain 31337): five local processes, E6a to E6g, and the T54
    schema check on the written file."""
    settings, chain = base
    snap = chain._rpc("evm_snapshot", [])
    out = tmp_path / "evidence-31337.json"
    try:
        env = {k: v for k, v in os.environ.items() if not k.endswith("_KEY")}
        env.update({"RPC_URL": settings.rpc_url, "DEPLOYMENTS_PATH": os.environ.get("DEPLOYMENTS_PATH", ""),
                    "PYTHONUNBUFFERED": "1"})
        proc = subprocess.run([sys.executable, "scripts/evidence_84532.py", "--chain", "31337", "--phases", "e6",
                               "--out", str(out)], cwd=SERVICE, env=env, capture_output=True, text=True, timeout=900)
        assert proc.returncode == 0, proc.stdout[-4000:] + proc.stderr[-4000:]
        doc = json.loads(out.read_text())
        ids = {s["id"]: s for s in doc["scenarios"]}
        assert {"E6a", "E6b", "E6c", "E6d", "E6e", "E6f", "E6g"} <= set(ids)
        assert all(ids[s]["status"] == "recorded" for s in ("E6a", "E6b", "E6c", "E6d", "E6e", "E6f", "E6g"))
        sys.path.insert(0, str(SERVICE / "scripts"))
        from evidence_84532 import check_e6

        assert check_e6(doc, doc["tradeflow"]["executor"]) == []
    finally:
        chain._rpc("evm_revert", [snap])
