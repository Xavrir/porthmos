from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from aegis.api.app import create_app
from aegis.chain.abi import Contract
from aegis.chain.fake import addr_of
from aegis.config import ANVIL_KEYS
from aegis.eip712 import Approval, sign_approval_typed


@pytest.fixture
def api(env):
    with TestClient(create_app(env.rt, start_background=False)) as client:
        yield client, env


def login(client, role):
    r = client.post("/api/session", json={"role": role, "address": addr_of(role)})
    assert r.status_code == 200, r.text
    return {"X-Aegis-Session": r.json()["token"]}


def test_health_and_sessions(api):
    client, env = api
    h = client.get("/api/health").json()
    assert h["ok"] and h["chainId"] == 31337 and h["agentMode"] == "deterministic"
    assert client.post("/api/session", json={"role": "owner", "address": addr_of("attacker")}).status_code == 403
    assert client.post("/api/session", json={"role": "admin", "address": addr_of("owner")}).status_code == 400
    assert client.get("/api/treasury").status_code == 401
    owner = client.post("/api/session", json={"role": "owner", "address": addr_of("owner")}).json()
    assert owner["safe"] == env.safe and not owner["readOnly"]
    bank = client.post("/api/session", json={"role": "bank", "address": addr_of("bank")}).json()
    assert bank["safe"] is None and bank["readOnly"]


def test_treasury_risk_oracle_shapes(api):
    client, env = api
    h = login(client, "owner")
    t = client.get("/api/treasury", headers=h).json()
    assert t["balances"]["safeUsdc"] == {"raw": "10000000000", "display": "10,000.00"}
    assert t["reserve"] == {**t["reserve"], "required": {"raw": "4500000000", "display": "4,500.00"},
                            "inSync": True}
    assert set(t["policy"]) >= {"autoCap", "dailyCap", "bankLimit", "frozen", "version"}
    risk = client.get("/api/risk", headers=h).json()
    assert set(risk["vaults"][0]["components"]) == {"peg", "liquidity", "utilisation", "concentration"}
    o = client.get("/api/oracle").json()
    assert o["price"]["raw"] == "100000000" and o["stale"] is False


def test_cross_client_refused_and_logged(api):
    client, env = api
    h = login(client, "owner")
    other = "0x1111111111111111111111111111111111111111"
    r = client.get(f"/api/treasury?safe={other}", headers=h)
    assert r.status_code == 403 and r.json()["error"] == "CrossClientRefused"
    assert client.get("/api/ledger", headers=h).json()["rows"][0]["kind"] == "CROSS_CLIENT_REFUSED"
    assert client.get("/api/bank/clients", headers=h).status_code == 403


def test_chat_approve_execute_and_bank_desk(api):
    client, env = api
    h = login(client, "owner")
    r = client.post("/api/agent/chat", json={"message": "deposit 2,000 USDC into vault B"}, headers=h).json()
    assert r["state"] == "AWAITING_APPROVAL"
    td = r["actionCard"]["approvalTypedData"]
    assert td["primaryType"] == "Approval" and td["domain"]["verifyingContract"] == env.settings.addresses.module
    sig = sign_approval_typed(ANVIL_KEYS["owner"], 31337, env.settings.addresses.module,
                              Approval.from_json(td["message"]))
    pending = client.get("/api/approvals/pending", headers=h).json()["pending"]
    assert [p["requestId"] for p in pending] == [r["requestId"]]
    a = client.post(f"/api/requests/{r['requestId']}/approval", json={"signature": sig, "approval": td["message"]},
                    headers=h).json()
    assert a["state"] == "SUBMITTED"
    env.settle()
    rec = client.get(f"/api/requests/{r['requestId']}", headers=h).json()
    assert rec["state"] == "EXPLAINED" and rec["outcome"] == "CONFIRMED" and rec["txHash"]
    assert [x["to"] for x in rec["history"]][-3:] == ["SUBMITTED", "CONFIRMED", "EXPLAINED"]
    events = client.get("/api/events", headers=h).json()["events"]
    assert any(e["event"] == "AegisExecuted" and e["darHash"] == rec["darHash"] for e in events)
    b = login(client, "bank")
    clients = client.get("/api/bank/clients", headers=b).json()["clients"]
    assert clients[0]["safe"] == env.safe and clients[0]["mismatches"] == 0
    assert client.post("/api/agent/chat", json={"message": "hi"}, headers=b).status_code == 403
    ledger = client.get("/api/ledger", headers=b).json()
    assert ledger["integrity"]["ok"]


def test_obligation_floor_update(api):
    client, env = api
    h = login(client, "owner")
    r = client.post("/api/obligations", json={"label": "Supplier invoice", "amount": "2000000000",
                                              "dueDate": "2026-09-30"}, headers=h).json()
    upd = r["floorUpdate"]
    assert upd["to"] == env.settings.addresses.registry and upd["value"] == "0"
    assert upd["data"].startswith("0x" + Contract("PolicyRegistry").selector("setReserveFloor").hex())
    assert upd["floor"]["raw"] == str(6_000 * 10**6 + 600 * 10**6)
    chat = client.post("/api/agent/chat", json={"message": "deposit the surplus"}, headers=h).json()
    assert "floor" in chat["reply"]
    settled = client.post(f"/api/obligations/{r['obligation']['id']}/settle", headers=h).json()
    assert settled["obligation"]["settled"] is True
    bad = client.post("/api/obligations", json={"label": "x", "amount": "-5", "dueDate": "2026-10-30"}, headers=h)
    assert bad.status_code == 400


def test_demo_scenarios(api):
    client, env = api
    h = login(client, "owner")
    assert client.post("/api/demo/scenario", json={"name": "depeg"}, headers=h).status_code == 200
    risk = client.get("/api/risk", headers=h).json()
    assert "PegDeviation" in [t["code"] for t in risk["vaults"][0]["triggers"]]
    client.post("/api/demo/scenario", json={"name": "restore"}, headers=h)
    client.post("/api/demo/scenario", json={"name": "stale"}, headers=h)
    assert client.get("/api/oracle").json()["stale"] is True
    assert client.post("/api/demo/scenario", json={"name": "nope"}, headers=h).status_code == 400


def test_stream_requires_session(api):
    client, _ = api
    assert client.get("/api/stream").status_code == 401


def test_fake_apply_floor_resyncs(api):
    client, env = api
    h = login(client, "owner")
    client.post("/api/obligations", json={"label": "Invoice", "amount": "2000000000", "dueDate": "2026-09-30"},
                headers=h)
    assert client.get("/api/treasury", headers=h).json()["reserve"]["inSync"] is False
    assert client.post("/api/demo/fake/apply-floor", headers=h).json()["applied"]
    assert client.get("/api/treasury", headers=h).json()["reserve"]["inSync"] is True
