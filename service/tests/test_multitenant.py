"""Multi-tenant behaviour (docs/MULTI-TENANT.md) on the in-memory chain: onboarding, isolation, limits, LLM."""

from __future__ import annotations

import json
import socket
import threading
import time
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import httpx
import pytest
import uvicorn
from eth_account import Account
from eth_account.messages import encode_defunct
from fastapi.testclient import TestClient

from aegis.agent.agent import Agent
from aegis.agent.llm import LlmClient
from aegis.api.app import create_app
from aegis.chain.fake import FakeChain, addr_of
from aegis.config import ANVIL_KEYS, USDC, load_settings
from aegis.core.reserve import required_reserve
from aegis.db import Database
from aegis.eip712 import Approval, sign_approval_typed
from aegis.onboarding import onboarding_message
from aegis.procs.authorizer import Authorizer
from aegis.runtime import Runtime
from aegis.siwe import client_message
from aegis.supervisor import child_env
from aegis.tenants import TenantStore


@dataclass
class Tenant:
    safe: str
    owner: object
    bank: object


def iso(delta: float = 0) -> str:
    return (datetime.now(UTC) + timedelta(seconds=delta)).isoformat()


def sign_text(acct, text: str) -> str:
    return "0x" + bytes(Account.sign_message(encode_defunct(text=text), acct.key).signature).hex()


def configure(env, owner, bank, module: bool = True, **overrides) -> str:
    """Stands in for the visitor's steps 3 to 6 (Safe, module, registry, bank limit) on the in-memory chain."""
    safe = env.chain.deploy_safe(owner.address, enable_module=module)
    params = dict(authorizer=addr_of("authorizer"), exit_key=addr_of("exitKey"), auto_cap=1000 * USDC,
                  daily_cap=5000 * USDC, bank_limit=3000 * USDC, max_band_width=2_000_000, max_oracle_age=180,
                  allowed={env.vault_a.lower(), env.vault_b.lower()})
    params.update(overrides)
    env.chain.register(safe, owner.address, bank.address, **params)
    return safe


def nonce(client) -> str:
    r = client.get("/api/auth/nonce")
    assert r.status_code == 200, r.text
    return r.json()["nonce"]


def activation(client, owner, safe: str, chain_id: int = 31337, signer=None) -> dict:
    message = client_message(address=owner.address, chain_id=chain_id, nonce=nonce(client), activate_safe=safe)
    return {"safe": safe, "owner": owner.address, "message": message, "signature": sign_text(signer or owner, message)}


def siwe_session(client, acct, role: str, chain_id: int = 31337, **kw) -> dict:
    message = client_message(address=acct.address, chain_id=chain_id, nonce=nonce(client), role=role, **kw)
    return {"message": message, "signature": sign_text(acct, message)}


def fund_body(owner, bank, issued: str | None = None, chain_id: int = 31337) -> dict:
    issued = issued or iso()
    return {"owner": owner.address, "bank": bank.address, "issuedAt": issued,
            "signature": sign_text(owner, onboarding_message(owner.address, bank.address, chain_id, issued))}


def sync_floor(env, safe: str) -> None:
    res = required_reserve(env.services.obligations.list(safe, False), env.chain.now, env.settings.params)
    env.chain.apply_reserve_floor(safe, res.required, res.schedule_hash)


def onboard(client, env) -> Tenant:
    owner, bank = Account.create(), Account.create()
    safe = configure(env, owner, bank)
    r = client.post("/api/onboard/activate", json=activation(client, owner, safe))
    assert r.status_code == 200, r.text
    sync_floor(env, safe)
    return Tenant(safe, owner, bank)


def login(client, acct, role: str) -> dict:
    r = client.post("/api/session", json={"role": role, "address": acct.address})
    assert r.status_code == 200, r.text
    return {"X-Aegis-Session": r.json()["token"]}


def approve_as(client, env, headers, resp, acct):
    msg = resp["actionCard"]["approvalTypedData"]["message"]
    sig = sign_approval_typed(acct.key, env.settings.chain_id, env.settings.addresses.module, Approval.from_json(msg))
    return client.post(f"/api/requests/{resp['requestId']}/approval", json={"signature": sig, "approval": msg},
                       headers=headers)


@pytest.fixture
def api(env):
    with TestClient(create_app(env.rt, start_background=False)) as client:
        yield client, env


def test_onboard_config_shape(api):
    client, env = api
    c = client.get("/api/onboard/config").json()
    assert set(c) == {"chainId", "rpcUrl", "explorer", "safeSingleton", "safeProxyFactory", "fallbackHandler",
                      "registry", "module", "usdc", "priceFeed", "vaults", "operator", "params", "paramBounds",
                      "ethOwner", "ethBank", "testUsdc", "referenceSafe", "onboardingOpen"}
    assert c["params"] == {"autoCap": "1000000000", "dailyCap": "5000000000", "bankLimit": "3000000000",
                           "maxBandWidth": "2000000", "maxOracleAge": 180}
    assert c["paramBounds"]["maxOracleAgeMax"] == 3600 and c["testUsdc"] == "100000000000"
    assert c["operator"]["authorizer"] == addr_of("authorizer") and c["referenceSafe"] == env.safe
    assert c["onboardingOpen"] is True and [v["name"] for v in c["vaults"]] == ["Vault A", "Vault B"]


def test_fund_drips_once_per_address(api):
    client, env = api
    owner, bank = Account.create(), Account.create()
    bad = fund_body(owner, bank)
    bad["signature"] = sign_text(bank, onboarding_message(owner.address, bank.address, 31337, bad["issuedAt"]))
    assert client.post("/api/onboard/fund", json=bad).json()["error"] == "BadSignature"
    stale = fund_body(owner, bank, issued=iso(-400))
    assert client.post("/api/onboard/fund", json=stale).json()["error"] == "StaleSignature"
    assert client.post("/api/onboard/fund", json=fund_body(owner, owner)).status_code == 400
    r = client.post("/api/onboard/fund", json=fund_body(owner, bank)).json()
    t = env.settings.tenant
    assert {(x["address"], x["amountWei"]) for x in r["txs"]} == {(owner.address, str(t.eth_owner)),
                                                                   (bank.address, str(t.eth_bank))}
    assert not r["pending"] and env.chain.eth_balance(owner.address) == t.eth_owner
    env.chain.eth[owner.address.lower()] = 0
    assert client.post("/api/onboard/fund", json=fund_body(owner, bank)).json()["txs"] == []


def test_fund_daily_budget_and_ip_limit(api):
    client, env = api
    env.settings.limits.faucet_wei_per_day = env.settings.tenant.eth_owner + env.settings.tenant.eth_bank
    assert len(client.post("/api/onboard/fund", json=fund_body(Account.create(), Account.create())).json()["txs"]) == 2
    r = client.post("/api/onboard/fund", json=fund_body(Account.create(), Account.create()))
    assert r.status_code == 503 and r.json()["error"] == "FaucetEmpty"
    env.settings.limits.faucet_wei_per_day = 10**30
    env.settings.limits.onboard_per_ip_day = 3
    statuses = [client.post("/api/onboard/fund", json=fund_body(Account.create(), Account.create())).status_code
                for _ in range(3)]
    assert statuses == [200, 200, 429]


MISCONFIGS = {
    "WrongAuthorizer": dict(authorizer=addr_of("attacker")),
    "BadBank": "bank==owner",
    "VaultMissing:Vault B": "vault",
    "AutoCapOutOfBounds": dict(auto_cap=20_000 * USDC),
    "ModuleNotEnabled": dict(module=False),
    "WrongExitKey": dict(exit_key=addr_of("attacker")),
    "MaxOracleAgeOutOfBounds": dict(max_oracle_age=0),
}


@pytest.mark.parametrize("expected", list(MISCONFIGS))
def test_activation_rejects_misconfiguration(api, expected):
    client, env = api
    owner, bank = Account.create(), Account.create()
    change = MISCONFIGS[expected]
    if change == "bank==owner":
        safe = configure(env, owner, owner)
    elif change == "vault":
        safe = configure(env, owner, bank, allowed={env.vault_a.lower()})
    else:
        safe = configure(env, owner, bank, **change)
    r = client.post("/api/onboard/activate", json=activation(client, owner, safe))
    assert r.status_code == 409 and r.json()["error"] == "BadOnboardingState"
    assert expected in r.json()["failed"]
    assert env.chain.usdc_balance(safe) == 0 and safe not in env.services.safes
    session = client.post("/api/session", json={"role": "owner", "address": owner.address})
    assert session.status_code == 403 and session.json()["error"] == "NotActivated"


def test_activation_rejects_wrong_or_missing_safe(api):
    client, env = api
    owner, other = Account.create(), Account.create()
    r = client.post("/api/onboard/activate", json=activation(client, owner, env.chain.predict_safe(owner.address)))
    assert r.json()["failed"] == ["SafeNotDeployed"]
    foreign = configure(env, other, Account.create())
    r = client.post("/api/onboard/activate", json=activation(client, owner, foreign))
    assert r.json()["failed"] == ["UnexpectedSafeAddress"]
    body = activation(client, owner, env.chain.predict_safe(owner.address), signer=other)
    assert client.post("/api/onboard/activate", json=body).json()["error"] == "BadSignature"


def test_activation_mints_exactly_once(api):
    client, env = api
    owner, bank = Account.create(), Account.create()
    safe = configure(env, owner, bank)
    first = client.post("/api/onboard/activate", json=activation(client, owner, safe)).json()
    assert first["safe"] == safe and first["mintTx"] and first["tenant"]["activatedAt"]
    second = client.post("/api/onboard/activate", json=activation(client, owner, safe)).json()
    assert second["mintTx"] == first["mintTx"]
    assert env.chain.usdc_balance(safe) == env.settings.tenant.test_usdc
    env.services.db.execute("UPDATE tenants SET activated_at=NULL WHERE safe=?", (safe,))
    client.post("/api/onboard/activate", json=activation(client, owner, safe))
    assert env.chain.usdc_balance(safe) == env.settings.tenant.test_usdc
    kinds = [r["kind"] for r in env.services.ledger.rows(safe)]
    assert kinds.count("TENANT_ACTIVATED") == 2


def test_status_reports_each_step(api):
    client, env = api
    owner, bank = Account.create(), Account.create()
    st = client.get(f"/api/onboard/status?owner={owner.address}").json()
    assert st["safe"] == env.chain.predict_safe(owner.address) and not any(st["steps"].values())
    client.post("/api/onboard/fund", json=fund_body(owner, bank))
    safe = configure(env, owner, bank)
    st = client.get(f"/api/onboard/status?owner={owner.address}").json()
    assert st["bank"] == bank.address
    assert {k for k, v in st["steps"].items() if not v} == {"activated"}
    client.post("/api/onboard/activate", json=activation(client, owner, safe))
    st = client.get(f"/api/onboard/status?owner={owner.address}").json()
    assert all(st["steps"].values()) and st["tenant"]["safe"] == safe


def test_status_is_rate_limited_per_ip(api):
    client, _ = api
    owner = Account.create().address
    codes = [client.get(f"/api/onboard/status?owner={owner}").status_code for _ in range(61)]
    assert codes[:60] == [200] * 60 and codes[60] == 429


def test_exit_agent_skips_tenants_without_deposits(api):
    client, env = api
    a, b = onboard(client, env), onboard(client, env)
    seed_tenant_activity(client, env, a)
    env.chain.set_price(98_000_000)
    rep = env.rt.exit_agent.tick(force=True)
    exited = {env.services.db.one("SELECT safe FROM submissions WHERE id=?", (x["submissionId"],))["safe"]
              for x in rep["actions"] if x["action"] == "exit"}
    assert exited == {a.safe.lower()}
    assert not env.chain.policies[b.safe.lower()].quarantined_at
    assert env.chain.policies[a.safe.lower()].quarantined_at


def test_onboarding_closed_at_tenant_cap(api):
    client, env = api
    env.settings.limits.max_tenants = 1
    onboard(client, env)
    assert client.get("/api/onboard/config").json()["onboardingOpen"] is False
    owner, bank = Account.create(), Account.create()
    safe = configure(env, owner, bank)
    assert client.post("/api/onboard/activate", json=activation(client, owner, safe)).json()["error"] == "OnboardingClosed"
    assert client.post("/api/onboard/fund", json=fund_body(owner, bank)).json()["error"] == "OnboardingClosed"
    assert client.get("/api/health").json()["onboardingOpen"] is False


def test_sessions_bind_to_tenants(api):
    client, env = api
    a = onboard(client, env)
    s = client.post("/api/session", json={"role": "owner", "address": a.owner.address}).json()
    assert s["safe"] == a.safe and s["safes"] == [a.safe]
    b = client.post("/api/session", json={"role": "bank", "address": a.bank.address}).json()
    assert b["safe"] is None and b["safes"] == [a.safe] and b["readOnly"]
    ref = client.post("/api/session", json={"role": "owner", "address": addr_of("owner")}).json()
    assert ref["safe"] == env.safe
    assert client.post("/api/session", json={"role": "bank", "address": a.owner.address}).status_code == 403
    env.settings.require_session_sig = True
    assert client.post("/api/session", json={"role": "owner", "address": a.owner.address}).status_code == 401
    assert client.post("/api/session", json=siwe_session(client, a.owner, "owner")).json()["safe"] == a.safe


def test_owner_cannot_onboard_a_second_treasury(api):
    client, env = api
    owner, bank = Account.from_key(ANVIL_KEYS["owner"]), Account.create()
    safe = configure(env, owner, bank)
    r = client.post("/api/onboard/activate", json=activation(client, owner, safe))
    assert r.json()["failed"] == ["OwnerHasTreasury"]


def seed_tenant_activity(client, env, t: Tenant) -> dict:
    h = login(client, t.owner, "owner")
    r = client.post("/api/agent/chat", json={"message": "deposit 2,000 USDC into vault B"}, headers=h).json()
    assert r["state"] == "AWAITING_APPROVAL", r
    assert approve_as(client, env, h, r, t.owner).json()["state"] == "SUBMITTED"
    env.settle()
    pending = client.post("/api/agent/chat", json={"message": "deposit 1,500 USDC into vault A"}, headers=h).json()
    assert pending["state"] == "AWAITING_APPROVAL"
    ob = client.post("/api/obligations", json={"label": "Rent", "amount": "1000000000", "dueDate": "2026-12-01"},
                     headers=h).json()["obligation"]
    env.services.alert("warning", "TestAlert", "tenant A alert", t.safe)
    return {"executed": r["requestId"], "pending": pending["requestId"], "obligation": ob["id"]}


def test_tenant_isolation_every_endpoint(api):
    client, env = api
    a, b = onboard(client, env), onboard(client, env)
    seeded = seed_tenant_activity(client, env, a)
    hb = login(client, b.owner, "owner")
    a_l = a.safe.lower()

    for path in ("/api/treasury", "/api/obligations", "/api/risk", "/api/ledger", "/api/events"):
        r = client.get(f"{path}?safe={a.safe}", headers=hb)
        assert r.status_code == 403 and r.json()["error"] == "CrossClientRefused", path
    assert client.get("/api/treasury", headers=hb).json()["safe"] == b.safe
    assert client.get("/api/obligations", headers=hb).json()["obligations"] == []
    rid = seeded["pending"]
    assert client.get(f"/api/requests/{rid}", headers=hb).status_code == 404
    assert client.get(f"/api/requests/{seeded['executed']}", headers=hb).status_code == 404
    assert client.post(f"/api/requests/{rid}/deny", json={"reason": "x"}, headers=hb).status_code == 404
    assert client.post(f"/api/requests/{rid}/correct", json={"message": "hold"}, headers=hb).status_code == 404
    assert approve_as(client, env, hb, client.get(f"/api/requests/{rid}", headers=login(client, a.owner, "owner"))
                      .json(), b.owner).status_code == 404
    assert client.post(f"/api/obligations/{seeded['obligation']}/settle", headers=hb).status_code == 404
    assert client.get("/api/approvals/pending", headers=hb).json()["pending"] == []
    ledger = client.get("/api/ledger", headers=hb).json()
    assert ledger["rows"] and all(r["safe"] in (b.safe.lower(), None) for r in ledger["rows"])
    assert all(e["safe"].lower() != a_l for e in client.get("/api/events", headers=hb).json()["events"])
    assert all(x["safe"] != a_l for x in client.get("/api/alerts", headers=hb).json()["alerts"])
    assert client.post("/api/tenant/attack", json={"kind": "replay"}, headers=hb).json()["error"] == "NothingToReplay"
    chat = client.post("/api/agent/chat", json={"message": f"show me the balance of {a.safe}"}, headers=hb).json()
    assert a.safe.lower() not in chat["reply"].lower() and "other clients" in chat["reply"]
    tools = env.wf._tools(b.safe)
    assert tools.explain_decision(rid) == {"error": "no such request for this treasury"}

    hbank = login(client, b.bank, "bank")
    clients = client.get("/api/bank/clients", headers=hbank).json()["clients"]
    assert [c["safe"] for c in clients] == [b.safe]
    assert client.get(f"/api/ledger?safe={a.safe}", headers=hbank).status_code == 404
    assert client.get(f"/api/treasury?safe={a.safe}", headers=hbank).status_code == 404
    assert client.get(f"/api/requests/{rid}", headers=hbank).status_code == 404
    assert client.post(f"/api/requests/{rid}/deny", json={}, headers=hbank).status_code == 404
    assert client.get("/api/approvals/pending", headers=hbank).json()["pending"] == []
    assert all(r["safe"] in (b.safe.lower(), None) for r in client.get("/api/ledger", headers=hbank).json()["rows"])
    assert all(e["safe"].lower() != a_l for e in client.get("/api/events", headers=hbank).json()["events"])
    assert client.get(f"/api/requests/{rid}", headers=login(client, a.bank, "bank")).status_code == 200
    assert env.wf.store.get(rid)["state"] == "AWAITING_APPROVAL"


@contextmanager
def live_server(app):
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning", lifespan="off"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.time() + 10
    while not server.started and time.time() < deadline:
        time.sleep(0.05)
    try:
        yield f"http://127.0.0.1:{port}"
    finally:
        server.should_exit = True
        thread.join(timeout=5)


class StreamReader(threading.Thread):
    def __init__(self, url: str, token: str):
        super().__init__(daemon=True)
        self.url, self.token = url, token
        self.events: list[dict] = []
        self.ready = threading.Event()
        self.done = threading.Event()

    def run(self):
        with httpx.stream("GET", f"{self.url}/api/stream", params={"session": self.token}, timeout=20) as r:
            for line in r.iter_lines():
                if not line.startswith("data:"):
                    continue
                data = json.loads(line[5:])
                if "role" in data and "type" not in data:
                    self.ready.set()
                    continue
                self.events.append(data)
                if data.get("type") == "sentinel":
                    break
        self.done.set()


def test_sse_stream_is_tenant_scoped(env):
    client = TestClient(create_app(env.rt, start_background=False))
    a, b = onboard(client, env), onboard(client, env)
    tokens = {name: client.post("/api/session", json={"role": role, "address": acct.address}).json()["token"]
              for name, role, acct in (("b_owner", "owner", b.owner), ("b_bank", "bank", b.bank),
                                       ("a_bank", "bank", a.bank))}
    with live_server(create_app(env.rt, start_background=False)) as url:
        readers = {n: StreamReader(url, t) for n, t in tokens.items()}
        for r in readers.values():
            r.start()
            assert r.ready.wait(10)
        seed_tenant_activity(client, env, a)
        env.rt.tail_events()
        env.services.bus.publish({"type": "oracle", "safe": None, "poke": "0x01"})
        env.services.bus.publish({"type": "state", "safe": b.safe, "requestId": "b-only"})
        for safe in (a.safe, b.safe):
            env.services.bus.publish({"type": "sentinel", "safe": safe})
        for r in readers.values():
            assert r.done.wait(10)
    a_l, b_l = a.safe.lower(), b.safe.lower()
    for name in ("b_owner", "b_bank"):
        seen = {str(e.get("safe") or "").lower() for e in readers[name].events}
        assert a_l not in seen and b_l in seen and "" in seen, name
    a_events = readers["a_bank"].events
    assert any(str(e.get("safe")).lower() == a_l and e["type"] == "state" for e in a_events)
    assert any(e["type"] == "ledger" for e in a_events)
    assert all(str(e.get("safe") or "").lower() in (a_l, "") for e in a_events)


def test_new_tenant_picked_up_by_other_processes(api, tmp_path):
    client, env = api
    other = TenantStore(Database(env.settings.db_path), refresh=0.2)
    before = other.safes()
    t = onboard(client, env)
    assert t.safe in env.services.safes
    time.sleep(0.25)
    assert t.safe in other.safes() and t.safe not in before
    auth = Authorizer(env.settings, env.chain, ANVIL_KEYS["authorizer"], Database(":memory:"), other)
    from aegis.eip712 import DAR, ZERO32
    dar = DAR(t.safe, 0, env.vault_a, USDC, 1, 1, 1, 1, 3, ZERO32, 7, env.chain.now - 4000, ZERO32)
    assert auth.sign_inert({"dar": dar.to_json()})["signer"] == addr_of("authorizer")


def test_attacks_tampered_and_replay(api):
    client, env = api
    t = onboard(client, env)
    h = login(client, t.owner, "owner")
    r = client.post("/api/tenant/attack", json={"kind": "tampered"}, headers=h).json()
    assert r["reverted"] is True and r["error"] == "BadSignature" and r["txHash"]
    assert client.post("/api/tenant/attack", json={"kind": "replay"}, headers=h).status_code == 409
    seed_tenant_activity(client, env, t)
    r = client.post("/api/tenant/attack", json={"kind": "replay"}, headers=h).json()
    assert r["reverted"] and r["error"] == "NonceUsed"
    rows = [x for x in env.services.ledger.rows(t.safe) if x["kind"] == "ATTACK_REFUSED"]
    assert [x["revert_reason"] for x in rows] == ["NonceUsed", "BadSignature"]
    assert client.post("/api/tenant/attack", json={"kind": "drain"}, headers=h).status_code == 400
    assert client.post("/api/tenant/attack", json={"kind": "tampered"},
                       headers=login(client, t.bank, "bank")).status_code == 403


def test_inert_signing_refuses_live_dars(env):
    from aegis.eip712 import DAR, ZERO32
    from aegis.errors import AuthorizerRefused

    auth = env.rt.authorizer
    live = DAR(env.safe, 0, env.vault_a, USDC, 1, 1, 1, 1, 3, ZERO32, 9, env.chain.now + 60, ZERO32)
    with pytest.raises(AuthorizerRefused, match="NotInert"):
        auth.sign_inert({"dar": live.to_json()})
    with pytest.raises(AuthorizerRefused, match="UnknownSafe"):
        auth.sign_inert({"dar": {**live.to_json(), "safe": addr_of("attacker"), "expiry": 1}})


def test_rate_limits_chat_and_attacks(api):
    client, env = api
    t = onboard(client, env)
    h = login(client, t.owner, "owner")
    env.settings.limits.chat_per_tenant = 2
    codes = [client.post("/api/agent/chat", json={"message": "status"}, headers=h).status_code for _ in range(3)]
    assert codes == [200, 200, 429]
    other = onboard(client, env)
    assert client.post("/api/agent/chat", json={"message": "status"},
                       headers=login(client, other.owner, "owner")).status_code == 200
    env.settings.limits.attacks_per_tenant_hour = 1
    assert client.post("/api/tenant/attack", json={"kind": "tampered"}, headers=h).status_code == 200
    r = client.post("/api/tenant/attack", json={"kind": "tampered"}, headers=h)
    assert r.status_code == 429 and r.json()["error"] == "RateLimited"


class SlowLlm(BaseHTTPRequestHandler):
    hits = 0

    def do_POST(self):
        type(self).hits += 1
        time.sleep(1.5)
        body = json.dumps({"choices": [{"message": {"content": "{}"}}]}).encode()
        try:
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(body)
        except OSError:
            pass

    def log_message(self, *args):
        pass


def test_llm_timeout_falls_back_for_the_request(make_env):
    server = ThreadingHTTPServer(("127.0.0.1", 0), SlowLlm)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        llm = LlmClient(f"http://127.0.0.1:{server.server_address[1]}/v1", "claude-haiku-5-5", timeout=0.3)
        e = make_env(agent=Agent(llm))
        started = time.time()
        r = e.chat("deposit 1,000 USDC into vault B")
        assert time.time() - started < 1.5
        assert r["state"] == "AWAITING_APPROVAL" and r["mode"] == "deterministic" and r["llmFallback"] == "error"
        assert r["reply"].splitlines()[-1].startswith("(The language model did not answer in time")
        assert SlowLlm.hits == 1
        r = e.chat("status")
        assert r["llmFallback"] == "error" and SlowLlm.hits == 1
    finally:
        server.shutdown()


class CountingLlm(LlmClient):
    def __init__(self):
        super().__init__("http://unused", "stub")
        self.calls = 0

    def complete_json(self, messages):
        self.calls += 1
        return {}


def test_llm_global_and_tenant_budgets(make_env):
    llm = CountingLlm()
    e = make_env(agent=Agent(llm))
    gate = e.rt.workflow.agent.gate
    gate.per_hour = 1
    r = e.chat("status")
    assert llm.calls == 1 and r["llmFallback"] == "limit" and "usage limit" in r["reply"]
    with TestClient(create_app(e.rt, start_background=False)) as client:
        assert client.get("/api/health").json()["llmMode"] == "rate-limited"
    gate.per_hour = 100
    gate.per_tenant_hour = 0
    r = e.chat("status")
    assert llm.calls == 1 and r["llmFallback"] == "limit"
    gate.per_tenant_hour = 100
    r = e.chat("status")
    assert "llmFallback" not in r and r["mode"] == "llm"


def test_health_reports_multi_tenant_fields(api):
    client, env = api
    onboard(client, env)
    h = client.get("/api/health").json()
    assert h["chainId"] == 31337 and h["tenantCount"] == 1 and h["onboardingOpen"] is True
    assert h["llmMode"] == "deterministic" and h["referenceSafe"] == env.safe and "safes" not in h
    assert {"blockLagSeconds", "keeper"} <= set(h) and "oracleAgeSeconds" in h["keeper"]
    env.rt.keeper.tick()
    assert client.get("/api/health").json()["keeper"]["lastPoke"]["tx"]


def test_cors_allows_only_configured_origins(api):
    client, _ = api
    pre = {"Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type,x-aegis-session"}
    ok = client.options("/api/session", headers={"Origin": "https://aegis-treasury-eta.vercel.app", **pre})
    assert ok.headers.get("access-control-allow-origin") == "https://aegis-treasury-eta.vercel.app"
    assert "access-control-allow-credentials" not in ok.headers
    bad = client.options("/api/session", headers={"Origin": "https://evil.example", **pre})
    assert "access-control-allow-origin" not in bad.headers


def test_obligations_expose_floor_update_for_new_tenant(api):
    client, env = api
    owner, bank = Account.create(), Account.create()
    safe = configure(env, owner, bank)
    client.post("/api/onboard/activate", json=activation(client, owner, safe))
    h = login(client, owner, "owner")
    ob = client.get("/api/obligations", headers=h).json()
    assert ob["reserve"]["inSync"] is False and ob["floorUpdate"]["floor"]["raw"] == str(500 * USDC)
    assert "floor" in client.post("/api/agent/chat", json={"message": "deposit 500 USDC"}, headers=h).json()["reply"]


@pytest.fixture
def testnet(tmp_path, monkeypatch):
    """Chain id 84532 on the in-memory chain: no Anvil fallbacks, admin-gated market scenarios."""
    for role in ("authorizer", "exitKey", "executor", "keeper"):
        monkeypatch.setenv({"authorizer": "AUTHORIZER_KEY", "exitKey": "EXIT_KEY", "executor": "EXECUTOR_KEY",
                            "keeper": "KEEPER_KEY"}[role], ANVIL_KEYS[role])
    chain, addresses = FakeChain.demo()
    chain.chain_id = 84532
    settings = load_settings(chain_mode="fake", chain_id=84532, addresses=addresses, db_path=str(tmp_path / "t.db"),
                             in_process_workers=True, demo_mode=False, admin_token="s3cret")
    rt = Runtime.build(settings, chain=chain)
    with TestClient(create_app(rt, start_background=False)) as client:
        yield client, rt, chain


def test_market_scenarios_need_admin_token_off_anvil(testnet, monkeypatch):
    client, rt, chain = testnet
    monkeypatch.setenv("ADMIN_KEY", ANVIL_KEYS["admin"])
    assert client.post("/api/demo/scenario", json={"name": "depeg"}).json()["error"] == "AdminRequired"
    bad = client.post("/api/demo/scenario", json={"name": "depeg"}, headers={"X-Aegis-Admin": "nope"})
    assert bad.status_code == 403
    ok = client.post("/api/demo/scenario", json={"name": "depeg"}, headers={"X-Aegis-Admin": "s3cret"})
    assert ok.status_code == 200 and chain.answer == 98_500_000
    m = client.get("/api/market").json()
    assert m["active"] == ["depeg"] and m["scenario"]["name"] == "depeg" and m["price"]["raw"] == "98500000"
    liq = client.post("/api/demo/scenario", json={"name": "liquidity", "vault": "Vault B", "cap": "5000000"},
                      headers={"X-Aegis-Admin": "s3cret"}).json()
    assert liq["vault"]["liquidityCap"]["raw"] == "5000000"
    stale = client.post("/api/demo/scenario", json={"name": "stale"}, headers={"X-Aegis-Admin": "s3cret"}).json()
    assert stale["keeperPaused"] and "advancedSeconds" not in stale
    client.post("/api/demo/scenario", json={"name": "restore"}, headers={"X-Aegis-Admin": "s3cret"})
    m = client.get("/api/market").json()
    assert m["active"] == [] and m["scenario"] is None and not m["keeper"]["paused"]
    r = client.post("/api/demo/scenario", json={"name": "obligation"}, headers={"X-Aegis-Admin": "s3cret"})
    assert r.json()["error"] == "DemoDisabled"


def test_testnet_onboarding_needs_faucet_key_and_owner_mint(testnet, monkeypatch):
    client, rt, chain = testnet
    assert client.get("/api/onboard/config").json()["onboardingOpen"] is False
    owner, bank = Account.create(), Account.create()
    env = type("E", (), {"chain": chain, "vault_a": rt.settings.addresses.vaults[0].address,
                         "vault_b": rt.settings.addresses.vaults[1].address})()
    safe = configure(env, owner, bank)
    assert client.post("/api/onboard/activate",
                       json=activation(client, owner, safe, 84532)).json()["error"] == "OnboardingClosed"
    monkeypatch.setenv("DEPLOYER_KEY", ANVIL_KEYS["attacker"])
    r = client.post("/api/onboard/activate", json=activation(client, owner, safe, 84532))
    assert r.status_code == 503 and r.json()["error"] == "FaucetEmpty"
    assert rt.services.tenants.get(safe)["mint_tx"] is None
    monkeypatch.setenv("DEPLOYER_KEY", ANVIL_KEYS["admin"])
    r = client.post("/api/onboard/activate", json=activation(client, owner, safe, 84532))
    assert r.status_code == 200 and chain.usdc_balance(safe) == rt.settings.tenant.test_usdc
    assert client.post("/api/session", json={"role": "owner", "address": owner.address}).status_code == 401


def test_supervisor_gives_each_process_only_its_secrets():
    base = {k: "x" for k in ("AUTHORIZER_KEY", "EXIT_KEY", "EXECUTOR_KEY", "KEEPER_KEY", "ADMIN_KEY", "DEPLOYER_KEY",
                             "ATTACKER_KEY", "LLM_API_KEY", "ADMIN_TOKEN")} | {"RPC_URL": "r", "INTERNAL_TOKEN": "t"}
    secret = lambda env: {k for k in env if k.endswith("_KEY") or k == "ADMIN_TOKEN"}  # noqa: E731
    assert secret(child_env("authorizer", base)) == {"AUTHORIZER_KEY"}
    assert secret(child_env("keeper", base)) == {"KEEPER_KEY"}
    assert secret(child_env("api", base)) == {"ADMIN_KEY", "DEPLOYER_KEY", "ATTACKER_KEY", "LLM_API_KEY",
                                              "ADMIN_TOKEN"}
    assert child_env("exit_agent", base)["INTERNAL_TOKEN"] == "t"

