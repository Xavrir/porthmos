"""A Coinbase-style smart contract wallet as the Safe owner, end to end on Anvil (TECHNICAL-DOCUMENT 02, Sessions).

The wallet (contracts/test/utils/MockSmartWallet.sol) has one EOA key, validates ERC-1271 over a replay-safe
EIP-712 wrap of the hash, and is deployed by a CREATE2 factory. Before deployment it signs the faucet message as
ERC-6492; after it, the SIWE activation and sign-in as ERC-1271. Every owner call goes through the wallet, and the
ten policy calls go in one atomic executeBatch, as an EIP-5792 wallet_sendCalls would.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime

import pytest
from eth_abi import encode as abi_encode
from eth_account import Account
from eth_account.messages import encode_defunct
from eth_utils import keccak, to_checksum_address
from fastapi.testclient import TestClient

from aegis.api.app import create_app
from aegis.chain import safe as safe_lib
from aegis.chain.abi import Contract
from aegis.chain.rpc import RpcChain
from aegis.config import ANVIL_KEYS, load_key, load_settings
from aegis.onboarding import onboarding_message
from aegis.runtime import Runtime
from aegis.sigverify import ERC6492_MAGIC, personal_hash, verify_personal
from aegis.siwe import client_message
from tests.integration.test_anvil import _reachable

pytestmark = pytest.mark.integration

REGISTRY = Contract("PolicyRegistry")


def selector(sig: str) -> bytes:
    return keccak(text=sig)[:4]


def replay_safe_hash(wallet: str, chain_id: int, digest: bytes) -> bytes:
    domain_type = keccak(text="EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")
    domain = keccak(abi_encode(["bytes32", "bytes32", "bytes32", "uint256", "address"],
                               [domain_type, keccak(text="Mock Smart Wallet"), keccak(text="1"), chain_id, wallet]))
    struct = keccak(abi_encode(["bytes32", "bytes32"], [keccak(text="MockSmartWalletMessage(bytes32 hash)"), digest]))
    return keccak(b"\x19\x01" + domain + struct)


class SmartWallet:
    def __init__(self, live, factory: str):
        self.live, self.factory = live, factory
        self.key = Account.create()
        self.create_calldata = selector("createAccount(address,uint256)") + abi_encode(["address", "uint256"],
                                                                                       [self.key.address, 0])
        out = live.chain._eth_call(factory, selector("getAddress(address,uint256)") +
                                   abi_encode(["address", "uint256"], [self.key.address, 0]))
        self.address = to_checksum_address("0x" + out[-20:].hex())

    def sign(self, text: str) -> str:
        digest = replay_safe_hash(self.address, 31337, personal_hash(text))
        inner = bytes(Account.unsafe_sign_hash(digest, self.key.key).signature)
        if self.live.chain.code_size(self.address) == 0:
            wrapped = abi_encode(["address", "bytes", "bytes"], [self.factory, self.create_calldata, inner])
            return "0x" + (wrapped + ERC6492_MAGIC).hex()
        return "0x" + inner.hex()

    def deploy(self):
        send(self.live, self.key, self.factory, self.create_calldata)
        assert self.live.chain.code_size(self.address) > 0

    def execute(self, to: str, data: bytes):
        send(self.live, self.key, self.address, selector("execute(address,uint256,bytes)") +
             abi_encode(["address", "uint256", "bytes"], [to, 0, data]))

    def execute_batch(self, calls: list[tuple[str, bytes]]):
        send(self.live, self.key, self.address, selector("executeBatch((address,uint256,bytes)[])") +
             abi_encode(["(address,uint256,bytes)[]"], [[(to, 0, data) for to, data in calls]]))


def send(live, acct, to: str, data: bytes, value: int = 0) -> None:
    rec = live.chain.wait_receipt(live.chain.send(acct.key, to, data, value=value))
    assert rec is not None and rec.status == 1, rec


def sign_text(acct, text: str) -> str:
    return "0x" + bytes(Account.sign_message(encode_defunct(text=text), acct.key).signature).hex()


@pytest.fixture(scope="module")
def live(tmp_path_factory):
    settings = load_settings(chain_mode="rpc")
    if not settings.addresses.safes or not settings.addresses.safe_proxy_factory:
        pytest.skip("deployments/31337.json with a Safe factory not found")
    if not _reachable(settings.rpc_url):
        pytest.skip(f"no RPC at {settings.rpc_url}")
    artifact = settings.contracts_out / "MockSmartWallet.sol" / "MockSmartWalletFactory.json"
    if not artifact.exists():
        pytest.skip("run forge build in contracts/ for MockSmartWalletFactory")
    settings.db_path = str(tmp_path_factory.mktemp("sw") / "aegis.db")
    settings.in_process_workers = True
    settings.require_session_sig = True
    chain = RpcChain(settings)
    snap_id = chain._rpc("evm_snapshot", [])
    chain.wait_receipt(chain.poke(load_key("keeper", 31337)))
    admin = Account.from_key(ANVIL_KEYS["admin"])
    bytecode = bytes.fromhex(json.loads(artifact.read_text())["bytecode"]["object"].removeprefix("0x"))
    tx = chain._rpc("eth_sendTransaction", [{"from": admin.address, "data": "0x" + bytecode.hex(),
                                             "gas": hex(3_000_000)}])
    assert chain.wait_receipt(tx).status == 1
    factory = chain._rpc("eth_getTransactionReceipt", [tx])["contractAddress"]
    rt = Runtime.build(settings, chain=chain)
    with TestClient(create_app(rt, start_background=False)) as client:
        ctx = type("Live", (), {})()
        ctx.rt, ctx.chain, ctx.settings, ctx.client = rt, chain, settings, client
        ctx.config = client.get("/api/onboard/config").json()
        ctx.factory = to_checksum_address(factory)
        ctx.admin = admin
        yield ctx
    chain._rpc("evm_revert", [snap_id])


def nonce(live) -> str:
    return live.client.get("/api/auth/nonce").json()["nonce"]


def test_smart_wallet_owner_onboards_and_signs_in(live):
    c, client, chain = live.config, live.client, live.chain
    w = SmartWallet(live, live.factory)
    bank = Account.create()
    send(live, live.admin, w.key.address, b"", value=10**18)
    assert chain.code_size(w.address) == 0

    issued = datetime.now(UTC).isoformat()
    text = onboarding_message(w.address, bank.address, 31337, issued)
    sig = w.sign(text)
    assert sig.endswith(ERC6492_MAGIC.hex()) and verify_personal(chain, w.address, text, sig) == "erc6492"
    assert chain.code_size(w.address) == 0
    assert verify_personal(chain, w.address, text, sign_text(w.key, text)) is None
    r = client.post("/api/onboard/fund", json={"owner": w.address, "bank": bank.address, "issuedAt": issued,
                                               "signature": sig})
    assert r.status_code == 200, r.text
    assert {t["address"] for t in r.json()["txs"]} == {w.address, bank.address}

    w.deploy()
    safe = client.get(f"/api/onboard/status?owner={w.address}").json()["safe"]
    send(live, w.key, c["safeProxyFactory"], safe_lib.create_proxy_data(c["safeSingleton"], w.address,
                                                                        c["fallbackHandler"]))
    w.execute(safe, safe_lib.enable_module_exec_data(safe, c["module"], w.address))
    p, reg = c["params"], c["registry"]
    s = to_checksum_address(safe)
    w.execute_batch([(reg, REGISTRY.encode(fn, *args)) for fn, args in (
        ("register", (s, w.address, bank.address)),
        *[("addVault", (s, to_checksum_address(v["address"]))) for v in c["vaults"]],
        ("setAuthorizer", (s, c["operator"]["authorizer"])), ("setExitKey", (s, c["operator"]["exitKey"])),
        ("setAutoCap", (s, int(p["autoCap"]))), ("setDailyCap", (s, int(p["dailyCap"]))),
        ("setMaxBandWidth", (s, int(p["maxBandWidth"]))), ("setMaxOracleAge", (s, int(p["maxOracleAge"]))))])
    send(live, bank, reg, REGISTRY.encode("setBankLimit", s, int(p["bankLimit"])))

    message = client_message(address=w.address, chain_id=31337, nonce=nonce(live), activate_safe=safe)
    r = client.post("/api/onboard/activate", json={"safe": safe, "owner": w.address, "message": message,
                                                   "signature": w.sign(message)})
    assert r.status_code == 200, r.text
    act = r.json()
    assert act["mintTx"] and act["session"]["auth"] == "erc1271" and act["session"]["safe"] == safe

    message = client_message(address=w.address, chain_id=31337, nonce=nonce(live))
    r = client.post("/api/session", json={"message": message, "signature": w.sign(message)})
    assert r.status_code == 200, r.text
    assert (r.json()["address"], r.json()["safe"], r.json()["auth"]) == (w.address, safe, "erc1271")
    assert client.get("/api/treasury", headers={"X-Aegis-Session": r.json()["token"]}).json()["safe"] == safe

    message = client_message(address=w.address, chain_id=31337, nonce=nonce(live))
    for forged in (sign_text(w.key, message),
                   "0x" + bytes(Account.unsafe_sign_hash(personal_hash(message), w.key.key).signature).hex(),
                   "0x" + bytes(Account.unsafe_sign_hash(replay_safe_hash(w.address, 31337, personal_hash(message)),
                                                         Account.create().key).signature).hex()):
        r = client.post("/api/session", json={"message": message, "signature": forged})
        assert r.status_code == 401 and r.json()["error"] == "BadSignature"
    roles = client.get(f"/api/auth/roles?address={w.address}").json()
    assert roles["owner"]["safe"] == safe and roles["contract"] is True


def test_counterfactual_wallet_signature_is_checked_without_deploying(live):
    w = SmartWallet(live, live.factory)
    text = "hello"
    good = w.sign(text)
    assert verify_personal(live.chain, w.address, text, good) == "erc6492"
    other = SmartWallet(live, live.factory)
    assert verify_personal(live.chain, other.address, text, good) is None
    assert live.chain.code_size(w.address) == 0
