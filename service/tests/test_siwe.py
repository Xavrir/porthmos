"""Sign-In with Ethereum (EIP-4361): message format, nonce lifecycle, domain/URI/chain/time checks, role binding,
and smart contract wallet signatures (ERC-1271, ERC-6492) on the in-memory chain."""

from __future__ import annotations

import time
from dataclasses import replace

import pytest
from eth_abi import encode as abi_encode
from eth_account import Account
from eth_account.messages import encode_defunct
from fastapi.testclient import TestClient

from aegis.api.app import create_app
from aegis.chain.fake import addr_of
from aegis.config import ANVIL_KEYS
from aegis.core.reserve import required_reserve
from aegis.onboarding import onboarding_message
from aegis.sigverify import ERC6492_MAGIC, personal_hash, verify_personal
from aegis.siwe import (
    ACTIVATION_STATEMENT,
    SiweMessage,
    build,
    client_message,
    domain_allowed,
    parse,
    role_resource,
    session_statement,
)
from aegis.workflow import WorkflowError

OWNER = Account.from_key(ANVIL_KEYS["owner"])
BANK = Account.from_key(ANVIL_KEYS["bank"])


def sign_text(acct, text: str) -> str:
    return "0x" + bytes(Account.sign_message(encode_defunct(text=text), acct.key).signature).hex()


def sign_digest(acct, digest: bytes) -> bytes:
    return bytes(Account.unsafe_sign_hash(digest, acct.key).signature)


@pytest.fixture
def api(env):
    env.settings.require_session_sig = True
    with TestClient(create_app(env.rt, start_background=False)) as client:
        yield client, env


def nonce(client) -> str:
    r = client.get("/api/auth/nonce")
    assert r.status_code == 200, r.text
    assert r.headers["cache-control"] == "no-store"
    return r.json()["nonce"]


def signed(client, acct=OWNER, role="owner", signer=None, **kw) -> dict:
    message = client_message(address=acct.address, chain_id=31337, nonce=kw.pop("nonce", None) or nonce(client),
                             role=role, **kw)
    return {"message": message, "signature": sign_text(signer or acct, message)}


def edit(message: str, old: str, new: str) -> str:
    assert old in message
    return message.replace(old, new)


def error(resp) -> str:
    return resp.json().get("error")


def test_message_round_trips_and_matches_the_eip_4361_layout():
    text = client_message(address=OWNER.address.lower(), chain_id=84532, nonce="a1b2c3d4e5f6a7b8",
                          domain="porthmos.vercel.app", now=1_790_000_000)
    assert text.split("\n")[:7] == [
        "porthmos.vercel.app wants you to sign in with your Ethereum account:", OWNER.address, "",
        "Sign in to Porthmos as owner.", "", "URI: https://porthmos.vercel.app", "Version: 1"]
    assert text.endswith("Expiration Time: 2026-09-21T14:23:20.000Z\nResources:\n- urn:porthmos:role:owner")
    m = parse(text)
    assert (m.domain, m.chain_id, m.nonce, m.resources) == ("porthmos.vercel.app", 84532, "a1b2c3d4e5f6a7b8",
                                                            ("urn:porthmos:role:owner",))
    assert build(m) == text
    bare = replace(m, statement=None, resources=(), expiration_time=None)
    assert parse(build(bare)) == bare


@pytest.mark.parametrize("mutate", [
    lambda t: t.replace(OWNER.address, OWNER.address.lower()),
    lambda t: t.replace("Version: 1\n", "Version: 1 \n"),
    lambda t: t + "\n",
    lambda t: t.replace("\nNonce: ", "\nNonce: x-"),
    lambda t: t.replace("Issued At: ", "Issued At: yesterday "),
    lambda t: t.replace("\n\nURI:", "\nURI:"),
    lambda t: t.replace("Chain ID: 31337", "Chain ID: 0x7a69"),
    lambda t: t.replace("wants you", "wants  you"),
    lambda t: "\r\n".join(t.split("\n")),
])
def test_parser_refuses_non_canonical_text(mutate):
    text = client_message(address=OWNER.address, chain_id=31337, nonce="a1b2c3d4e5f6a7b8")
    with pytest.raises(WorkflowError) as e:
        parse(mutate(text))
    assert e.value.code == "SiweMalformed"


def test_domain_allowlist():
    allow = ["porthmos.vercel.app", "aegis-treasury-eta.vercel.app", "localhost:*", "127.0.0.1:*"]
    for ok in ("porthmos.vercel.app", "PORTHMOS.vercel.app", "aegis-treasury-eta.vercel.app", "localhost",
               "localhost:5173", "127.0.0.1:4173"):
        assert domain_allowed(ok, allow), ok
    for bad in ("evil-porthmos.vercel.app", "porthmos.vercel.app.evil.com", "porthmos.vercel.app:8443",
                "localhost.evil.com", "localhost:abc", "localhostx:5173", "127.0.0.2:5173", ""):
        assert not domain_allowed(bad, allow), bad
    assert domain_allowed("pr-3.porthmos.dev", ["*.porthmos.dev"]) and not domain_allowed("porthmos.dev", ["*.porthmos.dev"])


def test_nonce_is_single_use_and_a_replay_is_refused(api):
    client, env = api
    body = signed(client)
    first = client.post("/api/session", json=body)
    assert first.status_code == 200, first.text
    s = first.json()
    assert (s["role"], s["address"], s["safe"], s["auth"]) == ("owner", OWNER.address, env.safe, "eoa")
    replay = client.post("/api/session", json=body)
    assert replay.status_code == 401 and error(replay) == "NonceUsed"
    assert env.rt.sessions.get(s["token"]).address == OWNER.address


def test_unknown_and_expired_nonces(api):
    client, env = api
    assert error(client.post("/api/session", json=signed(client, nonce="ffffffffffffffff0000"))) == "BadNonce"
    n = nonce(client)
    env.services.db.execute("UPDATE auth_nonces SET expires_at=? WHERE nonce=?", (time.time() - 1, n))
    r = client.post("/api/session", json=signed(client, nonce=n))
    assert r.status_code == 401 and error(r) == "NonceExpired"


def test_time_window(api):
    client, _ = api
    now = time.time()
    assert error(client.post("/api/session", json=signed(client, now=now - 700, ttl=900))) == "StaleSignature"
    assert error(client.post("/api/session", json=signed(client, now=now - 300, ttl=200))) == "MessageExpired"
    assert error(client.post("/api/session", json=signed(client, now=now + 300))) == "BadIssuedAt"
    assert error(client.post("/api/session", json=signed(client, ttl=7200))) == "SiweMalformed"
    n = nonce(client)
    text = client_message(address=OWNER.address, chain_id=31337, nonce=n)
    no_expiry = build(replace(parse(text), expiration_time=None))
    r = client.post("/api/session", json={"message": no_expiry, "signature": sign_text(OWNER, no_expiry)})
    assert error(r) == "SiweMalformed"


def test_wrong_domain_uri_and_chain(api):
    client, _ = api
    assert error(client.post("/api/session", json=signed(client, domain="porthmos.vercel.app.evil.com"))) == "WrongDomain"
    assert error(client.post("/api/session", json=signed(client, domain="evil.example"))) == "WrongDomain"
    r = client.post("/api/session", json=signed(client, domain="porthmos.vercel.app", uri="https://evil.example"))
    assert r.status_code == 401 and error(r) == "WrongUri"
    assert error(client.post("/api/session", json=signed(client, domain="porthmos.vercel.app",
                                                         uri="http://porthmos.vercel.app"))) == "WrongUri"
    assert client.post("/api/session", json=signed(client, domain="porthmos.vercel.app")).status_code == 200
    n = nonce(client)
    text = client_message(address=OWNER.address, chain_id=84532, nonce=n)
    r = client.post("/api/session", json={"message": text, "signature": sign_text(OWNER, text)})
    assert r.status_code == 401 and error(r) == "WrongChain"


def test_domains_come_from_settings(api):
    client, env = api
    env.settings.siwe_domains = ["porthmos.vercel.app"]
    assert error(client.post("/api/session", json=signed(client, domain="localhost:5173"))) == "WrongDomain"


def test_role_binding(api):
    client, env = api
    good = signed(client, acct=BANK, role="bank")
    r = client.post("/api/session", json=good)
    assert r.status_code == 200 and r.json()["role"] == "bank" and r.json()["readOnly"] is True
    assert r.json()["safes"] == [env.safe]
    body = signed(client, acct=OWNER, role="owner")
    body["message"] = edit(body["message"], role_resource("owner"), role_resource("bank"))
    body["signature"] = sign_text(OWNER, body["message"])
    assert error(client.post("/api/session", json=body)) == "WrongRole"
    body = signed(client, acct=OWNER, role="owner")
    body["message"] = edit(body["message"], session_statement("owner"), "Sign in to Porthmos as admin.")
    body["signature"] = sign_text(OWNER, body["message"])
    assert error(client.post("/api/session", json=body)) == "WrongStatement"
    assert error(client.post("/api/session", json={**signed(client), "role": "bank"})) == "WrongRole"
    assert error(client.post("/api/session", json={**signed(client), "address": BANK.address})) == "BadAddress"
    r = client.post("/api/session", json=signed(client, acct=OWNER, role="bank"))
    assert r.status_code == 403 and error(r) == "NotABank"
    r = client.post("/api/session", json=signed(client, acct=OWNER, signer=BANK))
    assert r.status_code == 401 and error(r) == "BadSignature"


def test_bad_signature_does_not_burn_the_nonce(api):
    client, _ = api
    body = signed(client)
    forged = {**body, "signature": sign_text(BANK, body["message"])}
    assert error(client.post("/api/session", json=forged)) == "BadSignature"
    assert client.post("/api/session", json=body).status_code == 200


def test_old_session_message_and_unsigned_sessions(api):
    client, env = api
    legacy = {"role": "owner", "address": OWNER.address, "issuedAt": "2026-10-17T00:00:00Z", "signature": "0x" + "11" * 65}
    r = client.post("/api/session", json=legacy)
    assert r.status_code == 400 and error(r) == "SiweRequired"
    r = client.post("/api/session", json={"role": "owner", "address": OWNER.address})
    assert r.status_code == 401 and error(r) == "SignatureRequired"
    env.settings.require_session_sig = False
    assert client.post("/api/session", json={"role": "owner", "address": OWNER.address}).json()["auth"] == "unsigned"


def test_nonce_rate_limit(api):
    client, env = api
    env.settings.limits.auth_per_ip_minute = 3
    assert [client.get("/api/auth/nonce").status_code for _ in range(4)] == [200, 200, 200, 429]


def _contract_owner_tenant(env, wallet: str, eoa) -> str:
    """A treasury whose owner is a smart contract wallet controlled by `eoa`."""
    env.chain.contract_wallets[wallet.lower()] = eoa.address
    safe = env.chain.deploy_safe(wallet)
    env.chain.register(safe, wallet, Account.create().address)
    env.services.db.execute("INSERT INTO tenants(safe, owner, bank, created_at, activated_at, ip_hash, mint_tx) "
                            "VALUES (?, ?, ?, ?, ?, 'x', '0x1')", (safe, wallet, addr_of("bank"), 1.0, 1.0))
    env.services.tenants.invalidate()
    return safe


def test_erc1271_smart_wallet_signs_in(api):
    client, env = api
    eoa = Account.create()
    wallet = Account.create().address
    safe = _contract_owner_tenant(env, wallet, eoa)
    message = client_message(address=wallet, chain_id=31337, nonce=nonce(client))
    sig = "0x" + sign_digest(eoa, personal_hash(message)).hex()
    assert verify_personal(None, wallet, message, sig) is None
    r = client.post("/api/session", json={"message": message, "signature": sig})
    assert r.status_code == 200, r.text
    assert (r.json()["safe"], r.json()["auth"], r.json()["address"]) == (safe, "erc1271", wallet)
    message = client_message(address=wallet, chain_id=31337, nonce=nonce(client))
    wrong = "0x" + sign_digest(Account.create(), personal_hash(message)).hex()
    assert error(client.post("/api/session", json={"message": message, "signature": wrong})) == "BadSignature"
    roles = client.get(f"/api/auth/roles?address={wallet}").json()
    assert roles["owner"] == {"safe": safe, "bank": addr_of("bank")} and roles["contract"] is True


def test_erc6492_counterfactual_wallet_can_ask_the_faucet(api):
    client, env = api
    eoa, bank = Account.create(), Account.create()
    wallet = Account.create().address
    env.chain.counterfactual_wallets[wallet.lower()] = eoa.address
    issued = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    text = onboarding_message(wallet, bank.address, 31337, issued)
    inner = sign_digest(eoa, personal_hash(text))
    wrapped = abi_encode(["address", "bytes", "bytes"], [addr_of("admin"), b"\x01\x02", inner]) + ERC6492_MAGIC
    r = client.post("/api/onboard/fund", json={"owner": wallet, "bank": bank.address, "issuedAt": issued,
                                               "signature": "0x" + wrapped.hex()})
    assert r.status_code == 200, r.text
    assert {t["address"] for t in r.json()["txs"]} == {wallet, bank.address}
    other = abi_encode(["address", "bytes", "bytes"], [addr_of("admin"), b"", sign_digest(bank, personal_hash(text))])
    r = client.post("/api/onboard/fund", json={"owner": wallet, "bank": bank.address, "issuedAt": issued,
                                               "signature": "0x" + (other + ERC6492_MAGIC).hex()})
    assert error(r) == "BadSignature"


def test_activation_needs_its_own_message_and_opens_the_session(api):
    client, env = api
    owner, bank = Account.create(), Account.create()
    safe = env.chain.deploy_safe(owner.address)
    env.chain.register(safe, owner.address, bank.address, authorizer=addr_of("authorizer"), exit_key=addr_of("exitKey"),
                       auto_cap=1000 * 10**6, daily_cap=5000 * 10**6, bank_limit=3000 * 10**6, max_band_width=2_000_000,
                       max_oracle_age=180, allowed={env.vault_a.lower(), env.vault_b.lower()})
    floor = required_reserve([], 0, env.settings.params)
    env.chain.apply_reserve_floor(safe, floor.required, floor.schedule_hash)
    sign_in = signed(client, acct=owner)
    r = client.post("/api/onboard/activate", json={"safe": safe, "owner": owner.address, **sign_in})
    assert r.status_code == 401 and error(r) == "WrongStatement"
    other = Account.create().address
    text = client_message(address=owner.address, chain_id=31337, nonce=nonce(client), activate_safe=other)
    r = client.post("/api/onboard/activate", json={"safe": safe, "owner": owner.address, "message": text,
                                                   "signature": sign_text(owner, text)})
    assert error(r) == "WrongRole"
    legacy = client.post("/api/onboard/activate", json={"safe": safe, "owner": owner.address,
                                                        "issuedAt": "2026-10-17T00:00:00Z", "signature": "0x00"})
    assert error(legacy) == "SiweRequired"
    text = client_message(address=owner.address, chain_id=31337, nonce=nonce(client), activate_safe=safe)
    assert ACTIVATION_STATEMENT in text and f"urn:porthmos:safe:{safe}" in text
    body = {"safe": safe, "owner": owner.address, "message": text, "signature": sign_text(owner, text)}
    r = client.post("/api/onboard/activate", json=body)
    assert r.status_code == 200, r.text
    session = r.json()["session"]
    assert (session["role"], session["address"], session["safe"]) == ("owner", owner.address, safe)
    assert client.get("/api/treasury", headers={"X-Aegis-Session": session["token"]}).status_code == 200
    assert error(client.post("/api/onboard/activate", json=body)) == "NonceUsed"
    assert error(client.post("/api/session", json={"message": text, "signature": body["signature"]})) == "WrongStatement"
    fresh = client_message(address=owner.address, chain_id=31337, nonce=nonce(client), activate_safe=safe)
    r = client.post("/api/session", json={"message": fresh, "signature": sign_text(owner, fresh)})
    assert error(r) == "WrongStatement"


def test_roles_endpoint(api):
    client, env = api
    r = client.get(f"/api/auth/roles?address={OWNER.address.lower()}").json()
    assert r["address"] == OWNER.address and r["owner"]["safe"] == env.safe and r["bank"] == [] and not r["contract"]
    b = client.get(f"/api/auth/roles?address={BANK.address}").json()
    assert b["owner"] is None and [x["safe"] for x in b["bank"]] == [env.safe]
    assert client.get("/api/auth/roles?address=nope").status_code == 400


def test_session_body_shape_from_the_browser(api):
    """The web client sends {message, signature} only: role and address come from the signed text."""
    client, env = api
    body = signed(client, domain="localhost:5173")
    assert set(body) == {"message", "signature"}
    s = client.post("/api/session", json=body).json()
    assert s["role"] == "owner" and s["safe"] == env.safe and SiweMessage
