"""TradeFlow on the in-memory chain (TECHNICAL-DOCUMENT 05, T29, T36 to T42, T48 to T51, T53; findings C1, C3 to C10
and V1 of docs/design-tribunal-v0.3/REVIEW.md)."""

from __future__ import annotations

import asyncio
import base64
import json
import time

import pytest
from eth_account import Account
from eth_account.messages import encode_typed_data
from eth_utils import keccak
from fastapi.testclient import TestClient

from aegis.agent.agent import Agent
from aegis.agent.llm import LlmClient
from aegis.api.app import create_app
from aegis.chain.base import SimResult
from aegis.chain.fake import DEMO_ISSUER_INDEX, FakeChain, addr_of
from aegis.config import ANVIL_KEYS, USDC, anvil_mnemonic_keys, load_issuer_key, load_settings
from aegis.eip712 import ZERO32, ZERO_ADDRESS, hex32, random_nonce
from aegis.errors import AuthorizerRefused
from aegis.events import EventBus
from aegis.runtime import Runtime
from aegis.supervisor import child_env
from aegis.tradeflow import explain as vagent
from aegis.tradeflow.typed import (
    AUTH_FIELDS,
    CONFIRMATION_FIELDS,
    PROOF_FIELDS,
    MilestoneProof,
    MilestoneTerms,
    ReleaseAuthorization,
    ReleaseConfirmation,
    auth_digest,
    confirmation_digest,
    proof_digest,
    proof_struct_hash,
    sign_typed,
    typed_data,
)
from tests.test_multitenant import login, onboard

ISSUER_KEYS = {role: anvil_mnemonic_keys()[i][1] for role, i in DEMO_ISSUER_INDEX.items()}
ROLE_OF_KIND = ("carrier", "sensor", "surveyor")
DAY = 86400


def default_terms(env, carrier: str | None = None) -> list[MilestoneTerms]:
    iss, now = env.settings.addresses.issuers, env.chain.now
    return [MilestoneTerms(200 * USDC, carrier or iss["carrier"], 0, True, False, 0, 0, now + 7 * DAY),
            MilestoneTerms(400 * USDC, iss["sensor"], 1, True, True, 200, 800, now + 21 * DAY),
            MilestoneTerms(400 * USDC, iss["surveyor"], 2, True, False, 0, 0, now + 30 * DAY)]


def make_order(env, safe: str | None = None, terms=None) -> tuple[int, str]:
    terms = terms or default_terms(env)
    supplier = Account.create().address
    tx, oid = env.chain.create_order(safe or env.safe, supplier, sum(t.amount for t in terms), b"\x01" * 32, terms)
    assert oid, env.chain.receipts[tx].revert_reason
    env.rt.tradeflow.sync_chain()
    return oid, supplier


def signed_proof(env, oid: int, idx: int, key: str | None = None, document: bytes | None = b"bill of lading",
                 **overrides) -> tuple[dict, str, bytes | None]:
    terms = env.chain.escrow_milestones(oid)[idx][0]
    fields = {"orderId": oid, "index": idx, "kind": terms.kind,
              "docHash": keccak(document) if document is not None else ZERO32,
              "minTempCenti": 400 if terms.checkTemp else 0, "maxTempCenti": 600 if terms.checkTemp else 0,
              "samples": 48 if terms.checkTemp else 0, "issuedAt": env.chain.now}
    fields.update(overrides)
    proof = MilestoneProof(**fields)
    sig = sign_typed(key or ISSUER_KEYS[ROLE_OF_KIND[terms.kind]], "MilestoneProof", env.settings.chain_id,
                     env.settings.addresses.trade_escrow, proof)
    return proof.to_json(), sig, document


def submit(env, oid, idx, **kw) -> dict:
    proof, sig, doc = signed_proof(env, oid, idx, **kw)
    return env.rt.tradeflow.submit_proof(oid, idx, proof, sig, doc)


def run(env, n: int = 1) -> None:
    for _ in range(n):
        env.rt.executor.tick()
        env.rt.tradeflow.tick()


def state(env, oid, idx) -> tuple[str, str | None]:
    m = env.rt.tradeflow.milestone(oid, idx)
    return m["state"], m["reason"]


def kinds(env, after: int = 0) -> list[str]:
    return [r["kind"] for r in reversed(env.services.ledger.rows(limit=10_000)) if r["id"] > after]


def last_id(env) -> int:
    rows = env.services.ledger.rows(limit=1)
    return rows[0]["id"] if rows else 0


@pytest.fixture
def spy(env, monkeypatch):
    calls = []
    real = env.rt.authorizer.sign_release

    def wrapped(payload):
        calls.append(payload)
        return real(payload)

    monkeypatch.setattr(env.rt.authorizer, "sign_release", wrapped)
    return calls


@pytest.fixture
def api(env):
    with TestClient(create_app(env.rt, start_background=False)) as client:
        yield client, env


def owner_headers(client) -> dict:
    return {"X-Aegis-Session": client.post("/api/session", json={"role": "owner",
                                                                 "address": addr_of("owner")}).json()["token"]}


def walk(obj):
    if isinstance(obj, dict):
        for k, v in obj.items():
            yield k, v
            yield from walk(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from walk(v)


# T29 ------------------------------------------------------------------------------------------------------------


@pytest.mark.parametrize("primary,fields,msg", [
    ("MilestoneProof", PROOF_FIELDS,
     MilestoneProof(7, 1, 1, b"\x22" * 32, -1520, -300, 4_000_000_000, 2**63)),
    ("ReleaseAuthorization", AUTH_FIELDS,
     ReleaseAuthorization(2**200, 2, 400 * USDC, b"\x33" * 32, 2**64 - 1, 2**256 - 1, 1_790_000_120)),
    ("ReleaseConfirmation", CONFIRMATION_FIELDS, ReleaseConfirmation(9, 0, b"\x44" * 32, 1_790_086_400)),
])
def test_typed_digests_match_eth_account(primary, fields, msg):
    escrow = "0x" + "e5" * 20
    data = typed_data(primary, 84532, escrow, msg)
    values = {n: bytes.fromhex(v[2:]) if t == "bytes32" else int(v) for (n, t), v in
              zip(fields, data["message"].values())}
    expected = encode_typed_data(full_message={**data, "message": values})
    ours = {"MilestoneProof": proof_digest, "ReleaseAuthorization": auth_digest,
            "ReleaseConfirmation": confirmation_digest}[primary](84532, escrow, msg)
    assert ours == keccak(b"\x19\x01" + expected.header + expected.body)
    other_chain = {"MilestoneProof": proof_digest, "ReleaseAuthorization": auth_digest,
                   "ReleaseConfirmation": confirmation_digest}[primary](31337, escrow, msg)
    assert other_chain != ours


def test_hand_abi_matches_td_interface():
    from aegis.chain.abi import ERROR_SELECTORS, Contract

    c = Contract("TradeEscrow")
    proof, auth = ("(uint256,uint8,uint8,bytes32,int32,int32,uint32,uint64)",
                   "(uint256,uint8,uint256,bytes32,uint64,uint256,uint64)")
    td = {
        "createOrder": "createOrder(address,uint256,bytes32,(uint256,address,uint8,bool,bool,int32,int32,uint64)[3])",
        "release": f"release(uint256,uint8,{proof},bytes,{auth},bytes)",
        "waive": "waive(uint256,uint8)", "refund": "refund(uint256)",
        "checkRelease": f"checkRelease(uint256,uint8,{proof},{auth})",
        "getOrder": "getOrder(uint256)", "getMilestone": "getMilestone(uint256,uint8)",
        "hashProof": f"hashProof({proof})", "proofStructHash": f"proofStructHash({proof})",
        "hashAuthorization": f"hashAuthorization({auth})",
    }
    for fn, sig in td.items():
        assert c.selector(fn) == keccak(text=sig)[:4], fn
    assert c.topic("MilestoneReleased") == keccak(
        text="MilestoneReleased(uint256,uint8,address,uint256,bytes32,bytes32,bool)")
    names = set(ERROR_SELECTORS.values())
    assert {"OrderNotActive", "OutOfOrder", "ProofMismatch", "BadProofTime", "ConditionNotMet",
            "AuthorizationMismatch", "DeadlineNotPassed", "NotRegistered", "BadIssuer"} <= names


# C3, M12 ---------------------------------------------------------------------------------------------------------


def test_supervisor_issuer_keys_and_internal_token_scope():
    base = {k: "x" for k in ("AUTHORIZER_KEY", "EXIT_KEY", "EXECUTOR_KEY", "KEEPER_KEY", "ADMIN_KEY", "DEPLOYER_KEY",
                             "ATTACKER_KEY", "LLM_API_KEY", "ADMIN_TOKEN", "ISSUER_CARRIER_KEY", "ISSUER_SENSOR_KEY",
                             "ISSUER_SURVEYOR_KEY")} | {"INTERNAL_TOKEN": "t", "RPC_URL": "r"}
    envs = {n: child_env(n, base) for n in ("api", "authorizer", "exit_agent", "executor", "keeper")}
    for name, env in envs.items():
        issuer = {k for k in env if k.startswith("ISSUER_")}
        assert issuer == ({"ISSUER_CARRIER_KEY", "ISSUER_SENSOR_KEY", "ISSUER_SURVEYOR_KEY"} if name == "api"
                          else set()), name
        assert ("INTERNAL_TOKEN" in env) == (name in ("api", "authorizer", "exit_agent")), name
        assert env["RPC_URL"] == "r"


def test_issuer_keys_derive_on_anvil_and_load_at_use(monkeypatch):
    carrier = anvil_mnemonic_keys()[8]
    assert load_issuer_key("carrier", 31337, carrier[0]) == carrier[1]
    assert load_issuer_key("carrier", 31337, Account.create().address) is None
    assert load_issuer_key("carrier", 84532, carrier[0]) is None
    monkeypatch.setenv("ISSUER_CARRIER_KEY", ANVIL_KEYS["attacker"])
    assert load_issuer_key("carrier", 84532, None) == ANVIL_KEYS["attacker"]


# C10, T53 --------------------------------------------------------------------------------------------------------


def test_tradeflow_disabled_without_escrow(tmp_path):
    chain, addresses = FakeChain.demo(tradeflow=False)
    settings = load_settings(chain_mode="fake", addresses=addresses, db_path=str(tmp_path / "a.db"),
                             in_process_workers=True)
    rt = Runtime.build(settings, chain=chain)
    assert rt.tradeflow is None
    with TestClient(create_app(rt, start_background=False)) as client:
        assert client.get("/api/tradeflow/config").json() == {"enabled": False}
        h = owner_headers(client)
        for method, path, body in (("get", "/api/tradeflow/orders", None), ("get", "/api/tradeflow/orders/1", None),
                                   ("post", "/api/tradeflow/orders/1/proofs", {}),
                                   ("post", "/api/tradeflow/orders/1/proofs/demo", {"index": 0}),
                                   ("post", "/api/tradeflow/orders/1/confirm",
                                    {"index": 0, "proofHash": "0x" + "0" * 64, "expiry": 1, "signature": "0x"})):
            r = getattr(client, method)(path, headers=h, **({"json": body} if body is not None else {}))
            assert r.status_code == 503 and r.json()["error"] == "TradeFlowDisabled", path
        t = client.get("/api/treasury", headers=h).json()
        assert "figures" not in t and client.get("/api/health").json()["tradeflow"] == {"enabled": False}
        r = client.post("/api/agent/chat", json={"message": "deposit 500 USDC into vault A"}, headers=h).json()
        assert r["state"] in ("AWAITING_APPROVAL", "SUBMITTED")
    rt.tick()


def test_config_reports_parameters_only(api):
    client, env = api
    c = client.get("/api/tradeflow/config").json()
    assert c["enabled"] is True and c["tradeEscrow"] == env.settings.addresses.trade_escrow
    assert c["multiSendCallOnly"] == env.settings.addresses.multi_send_call_only and c["token"] == env.chain.usdc_address
    assert c["issuers"] == env.settings.addresses.issuers and c["demoIssuers"] == {"carrier": True, "sensor": True,
                                                                                    "surveyor": True}
    assert c["limits"]["maxDocumentBytes"] == 1_048_576 and c["limits"]["maxActiveOrders"] == 5


# T36, C4 ---------------------------------------------------------------------------------------------------------


def test_valid_proof_reaches_release_signed_and_releases(env, spy):
    oid, supplier = make_order(env)
    r = submit(env, oid, 0)
    assert r["state"] == "RELEASE_SIGNED" and len(spy) == 1
    run(env)
    assert state(env, oid, 0) == ("RELEASED", None) and env.chain.usdc_balance(supplier) == 200 * USDC
    view = env.rt.tradeflow.full_view(oid)["milestones"][0]
    assert [h["to"] for h in view["history"]] == ["PROOF_RECEIVED", "PROOF_VERIFIED", "RELEASE_SIGNED",
                                                  "RELEASE_SUBMITTED", "RELEASED"]
    assert [x["kind"] for x in view["ledgerRef"]] == ["PROOF_RECEIVED", "RELEASE_SIGNED", "MILESTONE_RELEASED"]
    sub = env.services.db.one("SELECT * FROM submissions WHERE source='release'")
    assert sub["status"] == "confirmed" and sub["claimed_by"] == "executor" and sub["op"] == 2


@pytest.mark.parametrize("case,overrides,reason", [
    ("outOfRange", {"maxTempCenti": 940}, "ConditionNotMet"),
    ("zeroSamples", {"samples": 0}, "ConditionNotMet"),
    ("minAboveMax", {"minTempCenti": 700, "maxTempCenti": 500}, "ConditionNotMet"),
    ("missingDoc", {"document": None}, "ConditionNotMet"),
    ("early", {"issuedAt": 1}, "BadProofTime"),
    ("future", {"issuedAt": 2_000_000_000}, "BadProofTime"),
])
def test_failed_conditions_hold_without_authorizer_call(env, spy, case, overrides, reason):
    oid, _ = make_order(env)
    submit(env, oid, 0)
    run(env)
    spy.clear()
    r = submit(env, oid, 1, **overrides)
    assert (r["state"], r["reason"]) == ("HELD", reason) and spy == []
    held = [row for row in env.services.ledger.rows(limit=5) if row["kind"] == "MILESTONE_HELD"]
    assert held and held[0]["payload"]["reason"] == reason and held[0]["payload"]["failedChecks"]
    assert env.services.db.one("SELECT COUNT(*) AS n FROM submissions WHERE source='release'")["n"] == 1


def test_deadline_passed_holds(env, spy):
    oid, _ = make_order(env)
    env.chain.admin_increase_time(8 * DAY)
    r = submit(env, oid, 0)
    assert (r["state"], r["reason"]) == ("HELD", "DeadlinePassed") and spy == []
    ex = env.rt.tradeflow.milestone(oid, 0)["data"]["explanation"]
    assert ex["proposal"] == "REFUND_AFTER_DEADLINE" and ex["source"] == "rules"


def _bad(env, oid):
    proof, sig, doc = signed_proof(env, oid, 0)
    other, _, _ = signed_proof(env, oid, 0, key=ANVIL_KEYS["attacker"])
    tampered = dict(proof, issuedAt=str(int(proof["issuedAt"]) - 1))
    return {
        "unsigned": (oid, 0, proof, "0x", doc, 422, "BadIssuerSignature"),
        "noSignature": (oid, 0, proof, None, doc, 422, "BadIssuerSignature"),
        "wrongIssuer": (oid, 0, other, signed_proof(env, oid, 0, key=ANVIL_KEYS["attacker"])[1], doc, 422,
                        "BadIssuerSignature"),
        "tampered": (oid, 0, tampered, sig, doc, 422, "BadIssuerSignature"),
        "wrongOrder": (oid, 0, dict(proof, orderId="999"), sig, doc, 422, "ProofMismatch"),
        "wrongIndex": (oid, 1, proof, sig, doc, 422, "ProofMismatch"),
        "wrongKind": (oid, 0, dict(proof, kind=2), sig, doc, 422, "ProofMismatch"),
        "unknownOrder": (999, 0, proof, sig, doc, 404, "UnknownOrder"),
        "badIndex": (oid, 3, proof, sig, doc, 422, "BadIndex"),
        "malformed": (oid, 0, {"orderId": "x"}, sig, doc, 422, "MalformedProof"),
        "docMismatch": (oid, 0, proof, sig, b"another document", 422, "DocumentHashMismatch"),
        "docTooLarge": (oid, 0, proof, sig, b"x" * (1_048_576 + 1), 413, "DocumentTooLarge"),
    }


def test_admission_rejects_change_nothing_then_valid_proof_signs(env, spy):
    """C4 acceptance: an unsigned or mismatched proof gets 4xx with no ledger row and no state change; the valid proof
    that follows reaches RELEASE_SIGNED."""
    from aegis.workflow import WorkflowError

    oid, _ = make_order(env)
    before = (last_id(env), env.services.db.one("SELECT COUNT(*) AS n FROM tf_proofs")["n"])
    for case, (o, i, proof, sig, doc, status, code) in _bad(env, oid).items():
        with pytest.raises(WorkflowError) as e:
            env.rt.tradeflow.submit_proof(o, i, proof, sig, doc)
        assert (e.value.status, e.value.code) == (status, code), case
        assert (last_id(env), env.services.db.one("SELECT COUNT(*) AS n FROM tf_proofs")["n"]) == before, case
        assert state(env, oid, 0) == ("AWAITING_PROOF", None), case
    assert spy == []
    assert submit(env, oid, 0)["state"] == "RELEASE_SIGNED" and len(spy) == 1


def test_paid_milestone_and_inactive_order_are_refused(env):
    from aegis.workflow import WorkflowError

    oid, _ = make_order(env)
    submit(env, oid, 0)
    run(env)
    with pytest.raises(WorkflowError) as e:
        submit(env, oid, 0)
    assert e.value.code == "MilestoneAlreadyPaid"
    env.chain.admin_increase_time(22 * DAY)
    env.chain.escrow_refund(env.safe, oid)
    with pytest.raises(WorkflowError) as e:
        submit(env, oid, 1)
    assert e.value.code == "OrderNotActive"


def test_proof_endpoint_budgets_and_413(api):
    client, env = api
    oid, _ = make_order(env)
    env.settings.tradeflow.proofs_per_order_hour = 1
    env.settings.tradeflow.rejects_per_ip_hour = 4
    proof, sig, doc = signed_proof(env, oid, 0)
    body = {"index": 0, "proof": proof, "signature": sig, "document": base64.b64encode(doc).decode()}
    for _ in range(2):
        r = client.post(f"/api/tradeflow/orders/{oid}/proofs", json={**body, "signature": "0x"})
        assert r.status_code == 422 and r.json()["error"] == "BadIssuerSignature" and r.json()["admitted"] is False
    big = client.post(f"/api/tradeflow/orders/{oid}/proofs",
                      content=json.dumps({**body, "document": base64.b64encode(b"x" * 1_100_000).decode()}))
    assert big.status_code == 413 and big.json()["error"] == "DocumentTooLarge"
    ok = client.post(f"/api/tradeflow/orders/{oid}/proofs", json=body)
    assert ok.status_code == 200 and ok.json()["state"] == "RELEASE_SIGNED"
    assert env.services.limiter.count("tf_proof_order", str(oid), 3600) == 1
    assert client.post(f"/api/tradeflow/orders/{oid}/proofs", json={**body, "signature": "0x"}).status_code == 422
    locked = client.post(f"/api/tradeflow/orders/{oid}/proofs", json=body)
    assert locked.status_code == 429 and locked.json()["error"] == "RateLimited"
    run(env)
    p1, s1, d1 = signed_proof(env, oid, 1, document=b"sensor log")
    env.services.db.execute("DELETE FROM rate_events WHERE bucket='tf_reject_ip'")
    r = client.post(f"/api/tradeflow/orders/{oid}/proofs",
                    json={"index": 1, "proof": p1, "signature": s1, "document": base64.b64encode(d1).decode()})
    assert r.status_code == 429 and r.json()["error"] == "RateLimited"


# T37, V1, C6, C8 -------------------------------------------------------------------------------------------------


def _release_payload(env, oid, idx, *, proof=None, sig=None, amount=None, policy_version=None, expiry=None,
                     nonce=None, prior_hold=False, confirmation=None, safe=None) -> dict:
    if proof is None:
        p, sig, _ = signed_proof(env, oid, idx)
        proof = MilestoneProof.from_json(p)
    terms = env.chain.escrow_milestones(oid)[idx][0]
    pol = env.chain.policy(env.safe, [])
    auth = ReleaseAuthorization(oid, idx, terms.amount if amount is None else amount, proof_struct_hash(proof),
                                pol.policy_version if policy_version is None else policy_version,
                                nonce or random_nonce(), expiry or env.chain.now + 120)
    return {"requestId": "t", "safe": safe or env.safe, "orderId": str(oid), "index": idx, "proof": proof.to_json(),
            "issuerSignature": sig, "authorization": auth.to_json(), "priorHold": prior_hold,
            "confirmation": confirmation}


def _confirmation(env, oid, idx, proof_hash: bytes, key=ANVIL_KEYS["owner"], expiry=None) -> dict:
    c = ReleaseConfirmation(oid, idx, proof_hash, expiry or env.chain.now + DAY)
    return {**c.to_json(), "signature": sign_typed(key, "ReleaseConfirmation", 31337,
                                                   env.settings.addresses.trade_escrow, c)}


def test_authorizer_sign_release_refusals(make_env):
    env = make_env()
    auth = env.rt.authorizer
    oid, _ = make_order(env)

    def refused(payload, code):
        with pytest.raises(AuthorizerRefused) as e:
            auth.sign_release(payload)
        assert str(e.value).startswith(code), (code, str(e.value))

    refused(_release_payload(env, oid, 0, safe=addr_of("attacker")), "UnknownSafe")
    other = onboard(TestClient(create_app(env.rt, start_background=False)), env)
    env.chain.mint(other.safe, 0)
    refused(_release_payload(env, oid, 0, safe=other.safe), "WrongBuyer")
    refused(_release_payload(env, oid, 0, amount=999 * USDC), "AmountMismatch")
    p, s, _ = signed_proof(env, oid, 0, document=None)
    refused(_release_payload(env, oid, 0, proof=MilestoneProof.from_json(p), sig=s), "ConditionNotMet")
    p, s, _ = signed_proof(env, oid, 0, key=ANVIL_KEYS["attacker"])
    refused(_release_payload(env, oid, 0, proof=MilestoneProof.from_json(p), sig=s), "BadIssuerSignature")
    p, s, _ = signed_proof(env, oid, 0, issuedAt=env.chain.now + 60)
    refused(_release_payload(env, oid, 0, proof=MilestoneProof.from_json(p), sig=s), "BadProofTime")
    refused(_release_payload(env, oid, 1), "OutOfOrder")
    refused(_release_payload(env, oid, 0, policy_version=0), "PolicyVersionMismatch")
    refused(_release_payload(env, oid, 0, expiry=env.chain.now + 3600), "ExpiryOutOfRange")
    refused(_release_payload(env, oid, 0, expiry=env.chain.now), "ExpiryOutOfRange")
    signed = auth.sign_release(_release_payload(env, oid, 0, nonce=42))
    assert signed["signer"] == addr_of("authorizer")
    refused(_release_payload(env, oid, 0, nonce=42), "NonceUsed")
    refused(_release_payload(env, oid, 0, prior_hold=True), "ConfirmationRequired")
    env.chain.set_policy(env.safe, bank_frozen=True)
    refused(_release_payload(env, oid, 0), "Frozen")
    env.chain.set_policy(env.safe, bank_frozen=False, authorizer=addr_of("attacker"))
    refused(_release_payload(env, oid, 0), "AuthorizerNotCurrent")
    env.chain.set_policy(env.safe, authorizer=addr_of("authorizer"))

    env.chain.admin_increase_time(8 * DAY)
    p, s, _ = signed_proof(env, oid, 0)
    proof = MilestoneProof.from_json(p)
    ph = proof_struct_hash(proof)
    late = dict(proof=proof, sig=s)
    refused(_release_payload(env, oid, 0, **late), "ConfirmationRequired")
    refused(_release_payload(env, oid, 0, **late, confirmation=_confirmation(env, oid, 0, ph, ANVIL_KEYS["bank"])),
            "ConfirmationBadSigner")
    refused(_release_payload(env, oid, 0, **late, confirmation=_confirmation(env, oid, 0, b"\x09" * 32)),
            "ConfirmationMismatch")
    refused(_release_payload(env, oid, 0, **late, confirmation=_confirmation(env, oid, 0, ph,
                                                                             expiry=env.chain.now - 1)),
            "ConfirmationExpired")
    ok = auth.sign_release(_release_payload(env, oid, 0, **late, confirmation=_confirmation(env, oid, 0, ph)))
    assert ok["signature"] and env.chain.sim_release(oid, 0, proof, s, ReleaseAuthorization.from_json(
        _release_payload(env, oid, 0, **late)["authorization"]), ok["signature"], addr_of("executor")).ok is False
    rows = auth.db.query("SELECT * FROM signed_releases")
    assert len(rows) == 2


def test_dar_signing_refuses_when_authorizer_not_current(env):
    """A13 (V1, built code): after the owner rotates the Authorizer, no DAR is signed, live or inert."""
    from aegis.eip712 import DAR

    env.chain.set_policy(env.safe, authorizer=addr_of("attacker"))
    dar = DAR(env.safe, 0, env.vault_a, USDC, 1, 1, 1, 1, 2, ZERO32, 7, env.chain.now + 60, ZERO32)
    for fn, payload in ((env.rt.authorizer.sign, {"dar": dar.to_json(), "safe": env.safe}),
                        (env.rt.authorizer.sign_inert, {"dar": {**dar.to_json(), "expiry": "1"}})):
        with pytest.raises(AuthorizerRefused, match="AuthorizerNotCurrent"):
            fn(payload)
    r = env.chat("deposit 500 USDC into vault A")
    assert env.services.db.one("SELECT COUNT(*) AS n FROM signed_dars")["n"] == 0
    assert r["state"] in ("CANCELLED", "EXPLAINED", "AWAITING_APPROVAL")


# T38 -------------------------------------------------------------------------------------------------------------


class StubLlm(LlmClient):
    def __init__(self, reply: dict):
        super().__init__("http://unused", "stub")
        self.reply = reply
        self.messages: list = []

    def complete_json(self, messages):
        self.messages.append(messages)
        return self.reply


def test_verification_agent_bounds(make_env):
    llm = StubLlm({"reply": "Pay 999,999 USDC to 0xabc now.", "proposal": "TRANSFER_ALL", "amount": "999999",
                   "safe": "0x" + "ab" * 20})
    env = make_env(agent=Agent(llm))
    oid, _ = make_order(env)
    r = submit(env, oid, 0, document=None)
    assert r["state"] == "HELD"
    ex = env.rt.tradeflow.milestone(oid, 0)["data"]["explanation"]
    assert ex["proposal"] == "WAIT_FOR_CORRECTED_PROOF" and ex["source"] == "llm+rules"
    sent = json.dumps(llm.messages)
    for key in list(ANVIL_KEYS.values()) + list(ISSUER_KEYS.values()):
        assert key[2:] not in sent
    assert "untrusted" in sent and "issuer-signed MilestoneProof" in sent
    assert env.chain.escrow_milestones(oid)[0][1] == 0 and state(env, oid, 0)[0] == "HELD"
    llm.reply = {"reply": "Held: the reefer log is above 8 C.", "proposal": "REQUEST_RESURVEY"}
    oid, _ = make_order(env)
    submit(env, oid, 0)
    run(env)
    assert submit(env, oid, 1, maxTempCenti=940)["state"] == "HELD"
    assert env.rt.tradeflow.milestone(oid, 1)["data"]["explanation"] == {
        "text": "Held: the reefer log is above 8 C.", "proposal": "REQUEST_RESURVEY", "source": "llm"}


def test_verification_agent_deterministic_templates():
    terms = MilestoneTerms(400 * USDC, ZERO_ADDRESS, 1, True, True, 200, 800, 1_790_000_000)
    for st, reason, proposal in (("HELD", "ConditionNotMet", "REQUEST_RESURVEY"),
                                 ("HELD", "BadProofTime", "WAIT_FOR_CORRECTED_PROOF"),
                                 ("HELD", "DeadlinePassed", "REFUND_AFTER_DEADLINE"),
                                 ("HELD", "ReleaseFailed:BadSignature", "NO_ACTION"),
                                 ("WAITING", "Frozen", "NO_ACTION"), ("PROOF_VERIFIED", None, "NO_ACTION")):
        facts = vagent.facts_for(3, 1, terms, st, reason, [{"name": reason, "ok": False, "detail": "d"}], None)
        out = vagent.explain(Agent(None), facts)
        assert out["proposal"] == proposal and out["source"] == "rules" and "order 3" in out["text"]
        assert out["proposal"] in vagent.ACTIONS


# T39, C9 ---------------------------------------------------------------------------------------------------------

PUBLIC_KEYS = {"order", "milestones", "transactions", "view"}
OFFCHAIN = {"state", "reason", "proof", "proofs", "explanation", "ledgerRef", "history", "requestId", "waitingOn",
            "pendingProof", "authorization", "orderLedgerRef"}


def test_tenant_isolation_and_public_view(api):
    client, env = api
    b = onboard(client, env)
    oid, _ = make_order(env)
    submit(env, oid, 0, document=None)
    hb, hbank_b = login(client, b.owner, "owner"), login(client, b.bank, "bank")
    ha = owner_headers(client)
    assert [o["order"]["orderId"] for o in client.get("/api/tradeflow/orders", headers=ha).json()["orders"]] == [
        str(oid)]
    for h in (hb, hbank_b):
        assert client.get("/api/tradeflow/orders", headers=h).json()["orders"] == []
    for h in (None, hb, hbank_b):
        client.cookies.clear()
        v = client.get(f"/api/tradeflow/orders/{oid}", headers=h or {}).json()
        assert set(v) == PUBLIC_KEYS and v["view"] == "public"
        assert not OFFCHAIN & {k for k, _ in walk(v)}, h
        assert [m["status"] for m in v["milestones"]] == ["PENDING"] * 3
    full = client.get(f"/api/tradeflow/orders/{oid}", headers=ha).json()
    assert full["view"] == "full" and full["milestones"][0]["state"] == "HELD"
    bank_a = login(client, Account.from_key(ANVIL_KEYS["bank"]), "bank")
    assert client.get(f"/api/tradeflow/orders/{oid}", headers=bank_a).json()["view"] == "full"
    r = client.post(f"/api/tradeflow/orders/{oid}/proofs/demo", json={"index": 0}, headers=hb)
    assert r.status_code == 404
    r = client.post(f"/api/tradeflow/orders/{oid}/confirm", headers=hb, json={
        "index": 0, "proofHash": full["milestones"][0]["proof"]["proofHash"], "expiry": env.chain.now + DAY,
        "signature": "0x" + "00" * 65})
    assert r.status_code == 404
    assert client.post(f"/api/tradeflow/orders/{oid}/proofs/demo", json={"index": 0},
                       headers=hbank_b).status_code == 403
    client.cookies.clear()
    assert client.get("/api/tradeflow/orders/12345").status_code == 404
    assert client.get("/api/tradeflow/orders").status_code == 401


def test_tradeflow_stream_events_are_scoped(env):
    bus = env.services.bus
    other = "0x" + "77" * 20

    async def collect():
        _, qa = bus.subscribe([env.safe])
        _, qb = bus.subscribe([other])
        oid, _ = make_order(env)
        submit(env, oid, 0)
        await asyncio.sleep(0.05)
        out_a, out_b = [], []
        while not qa.empty():
            out_a.append(qa.get_nowait())
        while not qb.empty():
            out_b.append(qb.get_nowait())
        return out_a, out_b

    seen_a, seen_b = asyncio.run(collect())
    assert any(e["type"] == "tradeflow" for e in seen_a)
    assert all(e.get("safe") is None for e in seen_b)
    assert isinstance(bus, EventBus)


# T40 -------------------------------------------------------------------------------------------------------------


def test_demo_issuers_sign_only_their_milestones_and_limits(api):
    client, env = api
    h = owner_headers(client)
    stranger = Account.create().address
    oid, _ = make_order(env, terms=default_terms(env, carrier=stranger))
    r = client.post(f"/api/tradeflow/orders/{oid}/proofs/demo", json={"index": 0}, headers=h)
    assert r.status_code == 403 and r.json()["error"] == "NotDemoIssuer"
    assert client.post(f"/api/tradeflow/orders/{oid}/proofs/demo", json={"index": 1, "variant": "bogus"},
                       headers=h).status_code == 400
    env.settings.tradeflow.demo_proofs_per_tenant_hour = 3
    r = client.post(f"/api/tradeflow/orders/{oid}/proofs/demo", json={"index": 1}, headers=h).json()
    assert (r["state"], r["reason"]) == ("WAITING", "OutOfOrder")
    r = client.post(f"/api/tradeflow/orders/{oid}/proofs/demo", json={"index": 1}, headers=h)
    assert r.status_code == 429 and r.json()["error"] == "RateLimited"


def test_demo_out_of_range_matches_e6c(env):
    oid, _ = make_order(env)
    env.rt.tradeflow.demo_proof(env.owner, oid, 0, "valid")
    run(env)
    r = env.rt.tradeflow.demo_proof(env.owner, oid, 1, "outOfRange")
    assert (r["state"], r["reason"]) == ("HELD", "ConditionNotMet")
    proof = env.rt.tradeflow.full_view(oid)["milestones"][1]["proof"]["proof"]
    assert proof["maxTempCenti"] == 940 and proof["samples"] > 0


# T51, C6 ---------------------------------------------------------------------------------------------------------


def test_demo_issued_at_uses_chain_time_behind_wall_clock(env):
    env.chain.now = int(time.time()) - 30
    oid, _ = make_order(env)
    stale = submit(env, oid, 0, issuedAt=int(time.time()) + 1)
    assert (stale["state"], stale["reason"]) == ("HELD", "BadProofTime")
    oid2, _ = make_order(env)
    r = env.rt.tradeflow.demo_proof(env.owner, oid2, 0, "valid")
    proof = env.rt.tradeflow.full_view(oid2)["milestones"][0]["proof"]["proof"]
    assert r["state"] == "RELEASE_SIGNED" and int(proof["issuedAt"]) <= env.chain.head_timestamp() < time.time()


# T41 -------------------------------------------------------------------------------------------------------------


def test_treasury_figures_and_linked_obligation(api):
    client, env = api
    h = owner_headers(client)
    before = client.get("/api/treasury", headers=h).json()
    ob = client.post("/api/obligations", json={"label": "Supplier PO", "amount": str(1000 * USDC),
                                               "dueDate": env.chain.now + 10 * DAY}, headers=h).json()["obligation"]
    oid, _ = make_order(env)
    t = client.get("/api/treasury", headers=h).json()
    assert t["figures"]["committed"]["raw"] == str(1000 * USDC) == str(env.chain.escrow_committed_of(env.safe))
    assert t["figures"]["cash"]["raw"] == str(env.chain.usdc_balance(env.safe))
    assert t["figures"]["free"] == t["deployable"]
    assert int(before["figures"]["cash"]["raw"]) - int(t["figures"]["cash"]["raw"]) == 1000 * USDC
    reserve_with_ob = t["reserve"]["required"]["raw"]
    r = client.post(f"/api/tradeflow/orders/{oid}/link", json={"obligationId": ob["id"]}, headers=h).json()
    assert r["obligation"]["settled"] is True and int(r["floorUpdate"]["floor"]["raw"]) < int(reserve_with_ob)
    assert set(r["floorUpdate"]) == {"floor", "scheduleHash"}
    assert client.get("/api/treasury", headers=h).json()["reserve"]["required"]["raw"] == r["floorUpdate"]["floor"][
        "raw"]
    assert client.post(f"/api/tradeflow/orders/{oid}/link", json={"obligationId": ob["id"]},
                       headers=h).status_code == 409


def test_tradeflow_responses_carry_no_calldata(api):
    """C1: parameters only; the web encodes createOrder, waive, refund and the floor update itself."""
    client, env = api
    h = owner_headers(client)
    oid, _ = make_order(env)
    client.post(f"/api/tradeflow/orders/{oid}/proofs/demo", json={"index": 0, "variant": "outOfRange"}, headers=h)
    docs = [client.get("/api/tradeflow/config").json(), client.get(f"/api/tradeflow/orders/{oid}", headers=h).json(),
            client.get("/api/tradeflow/orders", headers=h).json()]
    for doc in docs:
        dicts = [v for _, v in walk(doc) if isinstance(v, dict)] + [doc]
        assert not [d for d in dicts if {"data", "calldata"} & set(d) or {"to", "value"} <= set(d)]
    res = docs[1]["milestones"][0]["resolution"]
    assert res["canWaive"] is True and res["orderId"] == str(oid) and res["index"] == 0


# T42 -------------------------------------------------------------------------------------------------------------


def test_bank_desk_tradeflow_and_reconciliation(api):
    client, env = api
    oid, _ = make_order(env)
    submit(env, oid, 0)
    run(env)
    submit(env, oid, 1, maxTempCenti=900)
    hb = login(client, Account.from_key(ANVIL_KEYS["bank"]), "bank")
    c = client.get("/api/bank/clients", headers=hb).json()["clients"][0]
    tf = c["tradeflow"]
    assert tf["activeOrders"] == 1 and tf["committed"]["raw"] == str(800 * USDC)
    assert tf["heldMilestones"] == [{"orderId": str(oid), "index": 1, "reason": "ConditionNotMet"}]
    assert tf["reconciliation"]["mismatches"] == 0 and tf["reconciliation"]["chainSettlements"] == 1
    env.chain.escrow_waive(env.safe, oid, 1)
    rec = client.get("/api/bank/clients", headers=hb).json()["clients"][0]
    assert rec["tradeflow"]["reconciliation"]["details"][0]["type"] == "event_without_ledger_row"
    assert rec["mismatches"] >= 1
    env.rt.tradeflow.tick()
    rec = client.get("/api/bank/clients", headers=hb).json()["clients"][0]["tradeflow"]
    assert rec["reconciliation"]["mismatches"] == 0 and rec["heldMilestones"] == []
    assert state(env, oid, 1)[0] == "WAIVED" and "MILESTONE_WAIVED" in kinds(env)


# T48, C5 ---------------------------------------------------------------------------------------------------------


def test_waiting_during_bank_freeze_releases_after_unfreeze(env, spy):
    oid, supplier = make_order(env)
    env.chain.set_policy(env.safe, bank_frozen=True)
    r = submit(env, oid, 0)
    assert (r["state"], r["reason"]) == ("WAITING", "Frozen") and spy == []
    run(env, 2)
    assert state(env, oid, 0) == ("WAITING", "Frozen")
    env.chain.set_policy(env.safe, bank_frozen=False)
    run(env)
    assert state(env, oid, 0)[0] == "RELEASE_SIGNED" and len(spy) == 1
    run(env)
    assert state(env, oid, 0)[0] == "RELEASED" and env.chain.usdc_balance(supplier) == 200 * USDC
    assert kinds(env).count("MILESTONE_WAITING") == 1
    assert not env.services.db.query("SELECT * FROM tf_confirmations")


def test_later_milestone_waits_for_earlier_release(env):
    oid, supplier = make_order(env)
    submit(env, oid, 0)
    run(env)
    assert submit(env, oid, 1, document=b"sensor log")["state"] == "RELEASE_SIGNED"
    r = submit(env, oid, 2, document=b"survey")
    assert (r["state"], r["reason"]) == ("WAITING", "OutOfOrder")
    run(env)
    assert state(env, oid, 1)[0] == "RELEASED" and state(env, oid, 2)[0] == "RELEASE_SIGNED"
    run(env)
    assert state(env, oid, 2)[0] == "RELEASED" and env.chain.usdc_balance(supplier) == 1000 * USDC
    assert env.services.db.one("SELECT status FROM tf_orders WHERE order_id=?", (oid,))["status"] == "COMPLETED"


def test_refund_ends_open_milestones_with_order_not_active(env):
    oid, _ = make_order(env)
    env.chain.set_policy(env.safe, owner_frozen=True)
    submit(env, oid, 0)
    assert state(env, oid, 0) == ("WAITING", "Frozen")
    env.chain.admin_increase_time(8 * DAY)
    env.chain.escrow_refund(env.safe, oid)
    run(env)
    assert [state(env, oid, i) for i in range(3)] == [("REFUNDED", "OrderNotActive")] * 3
    row = next(r for r in env.services.ledger.rows(limit=5) if r["kind"] == "ORDER_REFUNDED")
    assert row["tx_hash"] and [c["reason"] for c in row["payload"]["closed"]] == ["OrderNotActive"] * 3
    assert env.chain.usdc_balance(env.safe) == 10_000 * USDC


# T49, C7 ---------------------------------------------------------------------------------------------------------


def test_preflight_bad_signature_holds_after_one_attempt(env, spy, monkeypatch):
    oid, _ = make_order(env)
    monkeypatch.setattr(env.chain, "sim_release", lambda *a, **k: SimResult(False, "BadSignature"))
    mark = last_id(env)
    submit(env, oid, 0)
    run(env)
    assert state(env, oid, 0) == ("HELD", "ReleaseFailed:BadSignature") and len(spy) == 1
    assert kinds(env, mark) == ["PROOF_RECEIVED", "RELEASE_SIGNED", "RELEASE_FAILED", "MILESTONE_HELD"]
    failed = next(r for r in env.services.ledger.rows(limit=3) if r["kind"] == "RELEASE_FAILED")
    assert failed["payload"]["stage"] == "preflight" and failed["revert_reason"] == "BadSignature"


def test_one_policy_bump_resigns_once_then_releases(env, spy):
    oid, _ = make_order(env)
    submit(env, oid, 0)
    env.chain.set_policy(env.safe, daily_cap=4000 * USDC)
    run(env)
    assert state(env, oid, 0)[0] == "RELEASE_SIGNED" and len(spy) == 2
    run(env)
    m = env.rt.tradeflow.milestone(oid, 0)
    assert m["state"] == "RELEASED" and m["data"]["resigns"] == 1
    assert kinds(env).count("RELEASE_FAILED") == 1


def test_three_policy_mismatches_hold_after_two_resigns(env, spy):
    oid, _ = make_order(env)
    submit(env, oid, 0)
    for _ in range(3):
        env.chain.set_policy(env.safe, daily_cap=env.chain.policies[env.safe.lower()].daily_cap - USDC)
        run(env)
    assert state(env, oid, 0) == ("HELD", "ReleaseFailed:PolicyVersionMismatch") and len(spy) == 3
    assert kinds(env).count("RELEASE_FAILED") == 3 and kinds(env).count("RELEASE_SIGNED") == 3


def test_release_revert_maps_back_to_waiting(env, monkeypatch):
    oid, _ = make_order(env)
    submit(env, oid, 0)
    real = env.chain.submit_release

    def freeze_then_submit(*a, **k):
        env.chain.policies[env.safe.lower()].bank_frozen = True
        return real(*a, **k)

    monkeypatch.setattr(env.chain, "submit_release", freeze_then_submit)
    run(env)
    assert state(env, oid, 0) == ("WAITING", "Frozen")
    failed = next(r for r in env.services.ledger.rows(limit=5) if r["kind"] == "RELEASE_FAILED")
    assert failed["payload"]["stage"] == "revert" and failed["tx_hash"] and failed["revert_reason"] == "Frozen"
    assert env.rt.tradeflow.milestone(oid, 0)["data"]["resigns"] == 0


def test_front_run_release_counts_as_released(env):
    oid, supplier = make_order(env)
    submit(env, oid, 0)
    sub = env.services.db.one("SELECT * FROM submissions WHERE source='release'")
    r = json.loads(sub["dar"])
    tx = env.chain.submit_release(ANVIL_KEYS["attacker"], oid, 0, MilestoneProof.from_json(r["proof"]),
                                  r["issuerSig"], ReleaseAuthorization.from_json(r["auth"]), r["authSig"])
    assert env.chain.receipts[tx].status == 1
    run(env)
    assert state(env, oid, 0)[0] == "RELEASED" and env.chain.usdc_balance(supplier) == 200 * USDC
    assert kinds(env).count("MILESTONE_RELEASED") == 1


# T50, V1 ---------------------------------------------------------------------------------------------------------


def test_authorizer_not_current_waits_then_releases_after_restore(env, spy):
    oid, supplier = make_order(env)
    env.chain.set_policy(env.safe, authorizer=ZERO_ADDRESS)
    mark = last_id(env)
    r = submit(env, oid, 0)
    assert (r["state"], r["reason"]) == ("WAITING", "AuthorizerNotCurrent") and spy == []
    assert kinds(env, mark) == ["PROOF_RECEIVED", "MILESTONE_WAITING"]
    env.chain.set_policy(env.safe, authorizer=addr_of("authorizer"))
    run(env, 2)
    assert state(env, oid, 0)[0] == "RELEASED" and len(spy) == 1 and env.chain.usdc_balance(supplier) == 200 * USDC


# C8 --------------------------------------------------------------------------------------------------------------


def test_late_release_needs_owner_confirmation(api, spy):
    client, env = api
    h = owner_headers(client)
    oid, supplier = make_order(env)
    env.chain.admin_increase_time(8 * DAY)
    assert submit(env, oid, 0)["reason"] == "DeadlinePassed"
    view = client.get(f"/api/tradeflow/orders/{oid}", headers=h).json()["milestones"][0]
    params = view["resolution"]["confirmation"]
    assert params["proofHash"] == view["proof"]["proofHash"] and view["resolution"]["canRefund"] is True
    ph = bytes.fromhex(params["proofHash"][2:])

    def post(conf):
        return client.post(f"/api/tradeflow/orders/{oid}/confirm", headers=h, json={
            "index": 0, "proofHash": conf["proofHash"], "expiry": conf["expiry"], "signature": conf["signature"]})

    assert post(_confirmation(env, oid, 0, ph, ANVIL_KEYS["bank"])).json()["error"] == "BadSignature"
    assert post(_confirmation(env, oid, 0, ph, expiry=env.chain.now - 5)).json()["error"] == "ConfirmationExpired"
    assert post(_confirmation(env, oid, 0, b"\x07" * 32)).status_code == 404
    assert spy == []
    r = post(_confirmation(env, oid, 0, ph))
    assert r.status_code == 200 and r.json()["milestones"][0]["state"] == "RELEASE_SIGNED"
    assert spy[-1]["confirmation"]["proofHash"] == params["proofHash"]
    run(env)
    assert state(env, oid, 0)[0] == "RELEASED" and env.chain.usdc_balance(supplier) == 200 * USDC
    assert "RELEASE_CONFIRMED" in kinds(env)


def test_corrected_proof_after_hold_needs_confirmation(env, spy):
    oid, supplier = make_order(env)
    submit(env, oid, 0)
    run(env)
    spy.clear()
    assert submit(env, oid, 1, maxTempCenti=940)["state"] == "HELD"
    r = submit(env, oid, 1, document=b"corrected sensor log")
    assert r["awaitingConfirmation"] and state(env, oid, 1) == ("HELD", "ConditionNotMet") and spy == []
    m = env.rt.tradeflow.milestone(oid, 1)
    corrected = env.rt.tradeflow.full_view(oid)["milestones"][1]["pendingProof"]
    assert corrected["id"] == m["data"]["pendingProofId"]
    conf = _confirmation(env, oid, 1, bytes.fromhex(corrected["proofHash"][2:]))
    env.rt.tradeflow.confirm(env.owner, oid, 1, conf["proofHash"], conf["expiry"], conf["signature"])
    assert state(env, oid, 1)[0] == "RELEASE_SIGNED" and spy[-1]["priorHold"] is True
    run(env)
    assert state(env, oid, 1)[0] == "RELEASED" and env.chain.usdc_balance(supplier) == 600 * USDC


def test_held_milestone_waived_by_owner(env):
    oid, supplier = make_order(env)
    submit(env, oid, 0)
    run(env)
    submit(env, oid, 1, maxTempCenti=940)
    env.chain.escrow_waive(env.safe, oid, 1)
    run(env)
    assert state(env, oid, 1)[0] == "WAIVED" and env.chain.usdc_balance(supplier) == 600 * USDC
    row = next(r for r in env.services.ledger.rows(limit=3) if r["kind"] == "MILESTONE_WAIVED")
    assert row["payload"]["waived"] is True and row["tx_hash"]
    assert submit(env, oid, 2, document=b"survey")["state"] == "RELEASE_SIGNED"


# Active order cap, ledger integrity ------------------------------------------------------------------------------


def test_active_order_cap_and_ledger_integrity(env):
    from aegis.workflow import WorkflowError

    env.settings.tradeflow.max_active_orders = 1
    first, _ = make_order(env)
    second, _ = make_order(env)
    assert env.rt.tradeflow.order_row(second)["served"] == 0
    with pytest.raises(WorkflowError) as e:
        submit(env, second, 0)
    assert e.value.code == "ActiveOrderLimit"
    submit(env, first, 0)
    run(env)
    assert env.services.ledger.verify()["ok"]
    assert hex32(proof_struct_hash(MilestoneProof.from_json(signed_proof(env, first, 1)[0])))


# T54 -------------------------------------------------------------------------------------------------------------


def test_e6_schema_check():
    import importlib.util
    from pathlib import Path

    spec = importlib.util.spec_from_file_location("evidence", Path(__file__).parent.parent / "scripts" /
                                                  "evidence_84532.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    executor = "0x" + "99" * 20

    def settlement(sid):
        return {"id": sid, "status": "recorded", "requestId": "rel_1",
                "workflow": ["PROOF_RECEIVED", "PROOF_VERIFIED", "RELEASE_SIGNED", "RELEASE_SUBMITTED", "RELEASED"],
                "ledgerRef": [{"ledgerId": 3, "kind": "RELEASE_SIGNED"}, {"ledgerId": 4, "kind": "MILESTONE_RELEASED"}],
                "transactions": [{"label": "release", "hash": "0x" + "1" * 64, "from": executor, "role": "executor",
                                  "expected": "success"}]}

    doc = {"scenarios": [
        settlement("E6b"), settlement("E6e"),
        {"id": "E6c", "status": "recorded", "ledgerRef": [{"ledgerId": 7, "kind": "MILESTONE_HELD",
                                                           "reason": "ConditionNotMet"}],
         "transactions": [{"label": "forced submit (script-signed)", "hash": "0x" + "2" * 64, "ledgerBefore": 7,
                           "expected": "ConditionNotMet"}]}]}
    assert mod.check_e6(doc, executor) == []
    doc["scenarios"][0]["workflow"].remove("PROOF_VERIFIED")
    doc["scenarios"][1]["transactions"][0]["from"] = "0x" + "aa" * 20
    doc["scenarios"][2]["ledgerRef"][0]["reason"] = "BadProofTime"
    errors = mod.check_e6(doc, executor)
    assert len(errors) == 3
    recorded = json.loads((Path(__file__).parent.parent.parent / "deployments" / "evidence-84532.json").read_text())
    if any(s["id"].startswith("E6") and s.get("status") == "recorded" for s in recorded["scenarios"]):
        assert mod.check_e6(recorded, recorded["tradeflow"]["executor"]) == []
