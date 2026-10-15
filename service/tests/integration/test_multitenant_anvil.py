"""Multi-tenant end to end on Anvil (docs/MULTI-TENANT.md): two visitors onboard with fresh keys by sending the
exact client transaction sequence, A runs an agent deposit, B sees none of it, A's bank freezes, a deposit
reverts Frozen on chain and the Exit Agent still redeems. The chain is snapshotted and reverted.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, datetime

import pytest
from eth_account import Account
from eth_account.messages import encode_defunct
from eth_utils import to_checksum_address
from fastapi.testclient import TestClient

from aegis.api.app import create_app
from aegis.attacks import ATTACK_GAS
from aegis.chain import safe as safe_lib
from aegis.chain.abi import Contract
from aegis.chain.fake import addr_of
from aegis.chain.rpc import RpcChain
from aegis.config import ANVIL_KEYS, USDC, load_key, load_settings
from aegis.eip712 import DAR, Approval, sign_approval_typed
from aegis.onboarding import onboarding_message
from aegis.runtime import Runtime
from aegis.sessions import session_message
from tests.integration.test_anvil import _reachable

pytestmark = pytest.mark.integration

REGISTRY = Contract("PolicyRegistry")


@dataclass
class Visitor:
    owner: object
    bank: object
    safe: str = ""


def sign_text(acct, text: str) -> str:
    return "0x" + bytes(Account.sign_message(encode_defunct(text=text), acct.key).signature).hex()


@pytest.fixture(scope="module")
def live(tmp_path_factory):
    settings = load_settings(chain_mode="rpc")
    if not settings.addresses.safes:
        pytest.skip("deployments/31337.json not found")
    if not _reachable(settings.rpc_url):
        pytest.skip(f"no RPC at {settings.rpc_url}")
    if not settings.addresses.safe_proxy_factory:
        pytest.skip("deployments file has no Safe factory")
    settings.db_path = str(tmp_path_factory.mktemp("mt") / "aegis.db")
    settings.in_process_workers = True
    settings.demo_mode = True
    chain = RpcChain(settings)
    snap_id = chain._rpc("evm_snapshot", [])
    chain.wait_receipt(chain.poke(load_key("keeper", 31337)))
    rt = Runtime.build(settings, chain=chain)
    with TestClient(create_app(rt, start_background=False)) as client:
        ctx = type("Live", (), {})()
        ctx.rt, ctx.chain, ctx.settings, ctx.client = rt, chain, settings, client
        ctx.config = client.get("/api/onboard/config").json()
        yield ctx
    chain._rpc("evm_revert", [snap_id])


def send(live, acct, to: str, data: bytes) -> dict:
    tx = live.chain.send(acct.key, to, data)
    rec = live.chain.wait_receipt(tx)
    assert rec is not None and rec.status == 1, (tx, rec)
    return {"tx": tx, "block": rec.block_number}


def fund(live, v: Visitor) -> dict:
    issued = datetime.now(UTC).isoformat()
    body = {"owner": v.owner.address, "bank": v.bank.address, "issuedAt": issued,
            "signature": sign_text(v.owner, onboarding_message(v.owner.address, v.bank.address, 31337, issued))}
    r = live.client.post("/api/onboard/fund", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def activate(live, v: Visitor):
    issued = datetime.now(UTC).isoformat()
    return live.client.post("/api/onboard/activate", json={
        "safe": v.safe, "owner": v.owner.address, "issuedAt": issued,
        "signature": sign_text(v.owner, session_message("owner", v.owner.address, 31337, issued))})


def deploy_safe(live, v: Visitor) -> None:
    """Step 3: createProxyWithNonce with the spec's setup and salt; the address is predicted first."""
    c = live.config
    predicted = live.client.get(f"/api/onboard/status?owner={v.owner.address}").json()["safe"]
    assert live.chain.code_size(predicted) == 0
    send(live, v.owner, c["safeProxyFactory"],
         safe_lib.create_proxy_data(c["safeSingleton"], v.owner.address, c["fallbackHandler"]))
    assert live.chain.code_size(predicted) > 0
    v.safe = predicted


def enable_module(live, v: Visitor) -> None:
    """Step 4: Safe.execTransaction(enableModule) with the pre-validated owner signature."""
    send(live, v.owner, v.safe, safe_lib.enable_module_exec_data(v.safe, live.config["module"], v.owner.address))


def configure_registry(live, v: Visitor, authorizer: str | None = None, auto_cap: int | None = None,
                       vaults: list[str] | None = None, bank: str | None = None) -> None:
    """Step 5, in the spec's order. The keyword overrides only exist to build the misconfigured Safe."""
    c, p = live.config, live.config["params"]
    reg = c["registry"]
    s = to_checksum_address(v.safe)
    send(live, v.owner, reg, REGISTRY.encode("register", s, v.owner.address, bank or v.bank.address))
    for vault in vaults if vaults is not None else [x["address"] for x in c["vaults"]]:
        send(live, v.owner, reg, REGISTRY.encode("addVault", s, to_checksum_address(vault)))
    send(live, v.owner, reg, REGISTRY.encode("setAuthorizer", s, authorizer or c["operator"]["authorizer"]))
    send(live, v.owner, reg, REGISTRY.encode("setExitKey", s, c["operator"]["exitKey"]))
    send(live, v.owner, reg, REGISTRY.encode("setAutoCap", s, auto_cap or int(p["autoCap"])))
    send(live, v.owner, reg, REGISTRY.encode("setDailyCap", s, int(p["dailyCap"])))
    send(live, v.owner, reg, REGISTRY.encode("setMaxBandWidth", s, int(p["maxBandWidth"])))
    send(live, v.owner, reg, REGISTRY.encode("setMaxOracleAge", s, int(p["maxOracleAge"])))


def set_bank_limit(live, v: Visitor) -> None:
    """Step 6: the bank burner sets its limit."""
    send(live, v.bank, live.config["registry"],
         REGISTRY.encode("setBankLimit", to_checksum_address(v.safe), int(live.config["params"]["bankLimit"])))


def login(live, acct, role: str) -> dict:
    issued = datetime.now(UTC).isoformat()
    r = live.client.post("/api/session", json={"role": role, "address": acct.address, "issuedAt": issued,
                                               "signature": sign_text(acct, session_message(role, acct.address,
                                                                                            31337, issued))})
    assert r.status_code == 200, r.text
    return {"X-Aegis-Session": r.json()["token"]}


def onboard_exactly(live) -> Visitor:
    v = Visitor(Account.create(), Account.create())
    drips = fund(live, v)
    assert {t["address"] for t in drips["txs"]} == {v.owner.address, v.bank.address} and not drips["pending"]
    deploy_safe(live, v)
    enable_module(live, v)
    configure_registry(live, v)
    set_bank_limit(live, v)
    r = activate(live, v)
    assert r.status_code == 200, r.text
    return v


def settle(live):
    live.rt.executor.tick()
    live.rt.workflow.apply_submission_results()
    live.rt.exit_agent.track()


def test_two_tenants_end_to_end(live):
    chain, client, cfg = live.chain, live.client, live.config
    assert cfg["fallbackHandler"] != "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99" and cfg["onboardingOpen"]

    a = Visitor(Account.create(), Account.create())
    fund(live, a)
    deploy_safe(live, a)
    r = activate(live, a)
    assert r.status_code == 409 and "ModuleNotEnabled" in r.json()["failed"]
    enable_module(live, a)
    configure_registry(live, a)
    st = client.get(f"/api/onboard/status?owner={a.owner.address}").json()
    assert not st["steps"]["bankLimit"] and all(v for k, v in st["steps"].items() if k not in ("bankLimit",
                                                                                                   "activated"))
    assert "BankLimitOutOfBounds" in activate(live, a).json()["failed"]
    set_bank_limit(live, a)
    first = activate(live, a).json()
    again = activate(live, a).json()
    assert first["mintTx"] and again["mintTx"] == first["mintTx"]
    assert chain.usdc_balance(a.safe) == int(cfg["testUsdc"])
    assert chain.receipt(first["mintTx"]).status == 1

    c = Visitor(Account.create(), Account.create())
    fund(live, c)
    deploy_safe(live, c)
    enable_module(live, c)
    configure_registry(live, c, authorizer=addr_of("attacker"), auto_cap=20_000 * USDC,
                       vaults=[cfg["vaults"][0]["address"]], bank=c.owner.address)
    failed = activate(live, c).json()["failed"]
    assert {"WrongAuthorizer", "BadBank", "VaultMissing:Vault B", "AutoCapOutOfBounds"} <= set(failed)
    assert chain.usdc_balance(c.safe) == 0

    b = onboard_exactly(live)
    assert {a.safe, b.safe} <= set(live.rt.services.safes)
    assert client.get("/api/health").json()["tenantCount"] == 2

    ha = login(live, a.owner, "owner")
    ob = client.post("/api/obligations", json={"label": "Payroll", "amount": str(4000 * USDC),
                                               "dueDate": datetime.fromtimestamp(chain.block_timestamp() + 14 * 86400,
                                                                                 UTC).date().isoformat()},
                     headers=ha).json()
    send(live, a.owner, ob["floorUpdate"]["to"], bytes.fromhex(ob["floorUpdate"]["data"][2:]))
    assert client.get("/api/treasury", headers=ha).json()["reserve"]["inSync"] is True
    chain.wait_receipt(chain.poke(load_key("keeper", 31337)))
    r = client.post("/api/agent/chat", json={"message": "deposit 2,000 USDC into vault B"}, headers=ha).json()
    assert r["state"] == "AWAITING_APPROVAL" and r["actionCard"]["tier"] == 3, r
    msg = r["actionCard"]["approvalTypedData"]["message"]
    sig = sign_approval_typed(a.owner.key, 31337, cfg["module"], Approval.from_json(msg))
    assert client.post(f"/api/requests/{r['requestId']}/approval", json={"signature": sig, "approval": msg},
                       headers=ha).json()["state"] == "SUBMITTED"
    settle(live)
    rec = client.get(f"/api/requests/{r['requestId']}", headers=ha).json()
    assert rec["outcome"] == "CONFIRMED", rec.get("reason")
    shares_b = chain.shares_of(cfg["vaults"][1]["address"], a.safe)
    assert shares_b > 0

    tampered = client.post("/api/tenant/attack", json={"kind": "tampered"}, headers=ha).json()
    replay = client.post("/api/tenant/attack", json={"kind": "replay"}, headers=ha).json()
    for attack, error in ((tampered, "BadSignature"), (replay, "NonceUsed")):
        assert attack["reverted"] is True and attack["error"] == error, attack
        raw = chain._rpc("eth_getTransactionReceipt", [attack["txHash"]])
        assert raw["status"] == "0x0" and int(raw["blockNumber"], 16) > 0 and int(raw["gasUsed"], 16) < ATTACK_GAS
        assert raw["from"].lower() == addr_of("attacker").lower()

    hb, hbank_b = login(live, b.owner, "owner"), login(live, b.bank, "bank")
    a_l = a.safe.lower()
    for h in (hb, hbank_b):
        assert all(row["safe"] in (b.safe.lower(), None) for row in client.get("/api/ledger", headers=h).json()["rows"])
        assert all(e["safe"].lower() != a_l for e in client.get("/api/events", headers=h).json()["events"])
        assert client.get(f"/api/requests/{r['requestId']}", headers=h).status_code == 404
        assert client.get("/api/approvals/pending", headers=h).json()["pending"] == []
    assert client.get(f"/api/treasury?safe={a.safe}", headers=hb).status_code == 403
    assert client.get(f"/api/treasury?safe={a.safe}", headers=hbank_b).status_code == 404
    assert [x["safe"] for x in client.get("/api/bank/clients", headers=hbank_b).json()["clients"]] == [b.safe]
    tb = client.get("/api/treasury", headers=hb).json()
    assert tb["safe"] == b.safe and all(v["shares"] == "0" for v in tb["balances"]["vaults"])
    assert client.post("/api/tenant/attack", json={"kind": "replay"}, headers=hb).json()["error"] == "NothingToReplay"

    r2 = client.post("/api/agent/chat", json={"message": "deposit 500 USDC into vault B"}, headers=ha).json()
    assert r2["state"] == "SUBMITTED" and r2["actionCard"]["tier"] == 2, r2
    sub = live.rt.services.db.one("SELECT * FROM submissions WHERE request_id=?", (r2["requestId"],))
    send(live, a.bank, cfg["registry"], REGISTRY.encode("bankFreeze", to_checksum_address(a.safe)))
    dar = DAR.from_json(json.loads(sub["dar"]))
    tx = chain.submit_deposit(ANVIL_KEYS["executor"], dar, json.loads(sub["sigs"])["auth"], "", "",
                              Approval.empty(), gas=ATTACK_GAS)
    frozen = chain.wait_receipt(tx)
    assert frozen.status == 0 and frozen.revert_reason == "Frozen"
    settle(live)
    assert client.get(f"/api/requests/{r2['requestId']}", headers=ha).json()["outcome"] == "REVERTED"

    assert client.post("/api/demo/scenario", json={"name": "depeg"}, headers=ha).status_code == 200
    rep = live.rt.exit_agent.tick(force=True)
    exits = [x for x in rep["actions"] if x["action"] == "exit"]
    assert exits and all(live.rt.services.db.one("SELECT safe FROM submissions WHERE id=?", (x["submissionId"],))
                         ["safe"] == a_l for x in exits)
    settle(live)
    assert chain.policy(a.safe, []).bank_frozen and chain.shares_of(cfg["vaults"][1]["address"], a.safe) == 0
    assert "EXIT_CONFIRMED" in [row["kind"] for row in live.rt.services.ledger.rows(a.safe)]
    assert not [row for row in live.rt.services.ledger.rows(b.safe) if row["kind"].startswith("EXIT")]
    client.post("/api/demo/scenario", json={"name": "restore"}, headers=ha)
