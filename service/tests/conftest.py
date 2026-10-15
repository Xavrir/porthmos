from __future__ import annotations

import pytest

from aegis.chain.fake import FakeChain, addr_of
from aegis.config import ANVIL_KEYS, USDC, load_settings
from aegis.eip712 import Approval, sign_approval_typed
from aegis.runtime import Runtime
from aegis.workflow import Session

ENV_VARS = ("LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL", "AEGIS_CHAIN", "DEPLOYMENTS_PATH", "AEGIS_DB",
            "REQUIRE_SESSION_SIG", "EXECUTOR_WITHHOLD_EXITS", "AEGIS_IN_PROCESS_WORKERS", "CHAIN_ID")


@pytest.fixture(autouse=True)
def _hermetic_env(monkeypatch):
    for k in ENV_VARS:
        monkeypatch.delenv(k, raising=False)


class Env:
    """A FakeChain shaped like deployments/31337.json plus an API runtime with in-process workers."""

    def __init__(self, tmp_path, safe_usdc: int = 10_000 * USDC, agent=None, withhold: bool = False,
                 seed: bool = True):
        self.chain, addresses = FakeChain.demo(safe_usdc)
        settings = load_settings(chain_mode="fake", addresses=addresses, db_path=str(tmp_path / "aegis.db"),
                                 in_process_workers=True, executor_withhold_exits=withhold, demo_mode=seed)
        self.settings = settings
        self.rt = Runtime.build(settings, chain=self.chain, agent=agent)
        self.wf = self.rt.workflow
        self.services = self.rt.services
        self.safe = addresses.safes[0]
        self.vault_a = addresses.vaults[0].address
        self.vault_b = addresses.vaults[1].address
        self.owner = Session("t-owner", "owner", addr_of("owner"), self.safe)
        self.bank = Session("t-bank", "bank", addr_of("bank"), None)

    def chat(self, message: str, request_id: str | None = None) -> dict:
        return self.wf.chat(self.owner, message, request_id)

    def sign(self, response_or_card: dict, role: str = "owner") -> tuple[str, dict]:
        card = response_or_card.get("actionCard", response_or_card)
        approval_json = card["approvalTypedData"]["message"]
        sig = sign_approval_typed(ANVIL_KEYS[role], self.settings.chain_id, self.settings.addresses.module,
                                  Approval.from_json(approval_json))
        return sig, approval_json

    def approve(self, resp: dict, role: str = "owner") -> dict:
        sig, approval = self.sign(resp, role)
        session = self.owner if role == "owner" else self.bank
        return self.wf.approve(session, resp["requestId"], sig, approval)

    def settle(self) -> None:
        self.rt.executor.tick()
        self.wf.apply_submission_results()
        self.rt.exit_agent.track()

    def state(self, request_id: str) -> str:
        return self.wf.store.get(request_id)["state"]

    def ledger_kinds(self) -> list[str]:
        return [r["kind"] for r in reversed(self.services.ledger.rows(limit=10_000))]

    def shares(self, vault: str) -> int:
        return self.chain.shares_of(vault, self.safe)

    def apply_floor(self) -> None:
        from aegis.core.reserve import required_reserve

        obs = self.services.obligations.list(self.safe, False)
        res = required_reserve(obs, self.chain.now, self.settings.params)
        self.chain.apply_reserve_floor(self.safe, res.required, res.schedule_hash)


@pytest.fixture
def env(tmp_path):
    return Env(tmp_path)


@pytest.fixture
def make_env(tmp_path):
    counter = {"n": 0}

    def factory(**kw):
        counter["n"] += 1
        d = tmp_path / f"env{counter['n']}"
        d.mkdir()
        return Env(d, **kw)

    return factory


__all__ = ["Env", "USDC", "addr_of"]
