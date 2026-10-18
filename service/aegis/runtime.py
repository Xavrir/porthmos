"""Wires settings, chain client, stores, agent and workflow for the API process."""

from __future__ import annotations

import logging
import threading
import time

import httpx
from eth_account import Account

from aegis.agent.agent import Agent
from aegis.agent.llm import LlmClient, LlmGate
from aegis.chain.base import ChainClient
from aegis.chain.rpc import RpcError
from aegis.config import ANVIL_KEYS, USDC, Settings, load_key, load_settings
from aegis.core.reserve import required_reserve
from aegis.db import Database
from aegis.services import Services
from aegis.sessions import SessionManager
from aegis.tradeflow.milestones import TradeFlow
from aegis.workflow import Workflow

log = logging.getLogger("aegis")

DEMO_SEED_LABEL = "Payroll (demo seed)"


def make_chain(settings: Settings) -> ChainClient:
    if settings.chain_mode == "fake":
        from aegis.chain.fake import FakeChain

        chain, addresses = FakeChain.demo()
        chain.now = int(time.time())
        chain.updated_at = chain.now
        settings.addresses = addresses
        return chain
    from aegis.chain.rpc import RpcChain

    if not settings.addresses.safes:
        raise RuntimeError("no deployments file found; set DEPLOYMENTS_PATH or AEGIS_CHAIN=fake")
    return RpcChain(settings)


def seed_demo_obligations(services: Services) -> None:
    """On the demo chain only: a payroll schedule whose reserve (4,000 + 500 buffer) equals the deployed floor."""
    if not (services.settings.demo_mode and services.settings.is_local_chain):
        return
    now = services.chain.block_timestamp()
    for safe in services.safes:
        if services.obligations.list(safe):
            continue
        services.obligations.add(safe, DEMO_SEED_LABEL, 4000 * USDC, now + 14 * 86400)
        if services.settings.chain_mode == "fake":
            res = required_reserve(services.obligations.list(safe, False), now, services.settings.params)
            services.chain.apply_reserve_floor(safe, res.required, res.schedule_hash)


class Runtime:
    def __init__(self, settings: Settings, chain: ChainClient, services: Services, workflow: Workflow,
                 authorizer, in_process: bool):
        self.settings = settings
        self.chain = chain
        self.services = services
        self.workflow = workflow
        self.authorizer = authorizer
        self.sessions = SessionManager(services)
        self.tradeflow = TradeFlow(services, workflow.agent, authorizer) if settings.tradeflow_enabled else None
        workflow.tradeflow = self.tradeflow
        self.in_process = in_process
        self.executor = None
        self.exit_agent = None
        self.keeper = None
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._last: dict[str, float] = {}
        self._risk_cache: dict[str, str] = {}
        row = services.db.one("SELECT MAX(id) AS m FROM ledger")
        self._ledger_seen = (row or {}).get("m") or 0
        self._subs_seen = time.time()

    @classmethod
    def build(cls, settings: Settings | None = None, chain: ChainClient | None = None,
              db: Database | None = None, authorizer=None, agent: Agent | None = None) -> "Runtime":
        settings = settings or load_settings()
        chain = chain or make_chain(settings)
        services = Services.create(settings, chain, db)
        if agent is None:
            llm = LlmClient(settings.llm_base_url, settings.llm_model, settings.llm_api_key,
                            timeout=settings.llm_timeout) if settings.llm_enabled else None
            agent = Agent(llm)
        if agent.gate is None:
            agent.gate = LlmGate(services.limiter, settings.limits.llm_per_hour, settings.limits.llm_per_tenant_hour)
        in_process = settings.in_process_workers
        if authorizer is None:
            if in_process:
                from aegis.procs.authorizer import Authorizer

                authorizer = Authorizer(settings, chain, load_key("authorizer", settings.chain_id),
                                        Database(settings.db_path.replace(".db", "-authorizer.db"))
                                        if settings.db_path != ":memory:" else Database(":memory:"),
                                        services.tenants)
            else:
                from aegis.procs.authorizer import HttpAuthorizerClient

                authorizer = HttpAuthorizerClient(settings.authorizer_url, settings.internal_token,
                                                  settings.addresses.roles.get("authorizer"))
        executor_addr = settings.addresses.roles.get("executor") or Account.from_key(ANVIL_KEYS["executor"]).address
        workflow = Workflow(services, agent, authorizer, executor_addr)
        rt = cls(settings, chain, services, workflow, authorizer, in_process)
        seed_demo_obligations(services)
        if in_process:
            from aegis.procs.executor import Executor
            from aegis.procs.exit_agent import ExitAgent
            from aegis.procs.keeper import Keeper

            withhold = ("exit_agent",) if settings.executor_withhold_exits else ()
            rt.executor = Executor(services, load_key("executor", settings.chain_id), withhold)
            rt.exit_agent = ExitAgent(services, load_key("exitKey", settings.chain_id),
                                      notify=lambda safe, vault: workflow.drop_pending_deposits(safe, vault))
            rt.keeper = Keeper(services, load_key("keeper", settings.chain_id))
        return rt

    def _every(self, name: str, seconds: float) -> bool:
        now = time.time()
        if now - self._last.get(name, 0) >= seconds:
            self._last[name] = now
            return True
        return False

    def tick(self) -> None:
        with self.workflow.agent.request(None):
            self._tick()

    def _tick(self) -> None:
        if self.settings.chain_mode == "fake" and self._every("mine", 2):
            self.chain.follow_wall_clock()
        if self.executor is not None:
            self._step("executor", self.executor.tick)
        if self.exit_agent is not None:
            self._step("exit agent", self.exit_agent.tick)
        if self.keeper is not None and self._every("keeper", self.settings.params.keeper_interval):
            self._step("keeper", self.keeper.tick)
        if self._every("reconcile", 30):
            self._step("chain reconciliation", self.workflow.reconcile_onchain)
        self._step("submission results", self.workflow.apply_submission_results)
        if self.tradeflow is not None:
            self._step("tradeflow", self.tradeflow.tick)
        self._step("event tail", self.tail_events)
        if self._every("expire", 10):
            self._step("approval expiry", self.workflow.expire_approvals)
        if self._every("risk", 10):
            self._step("risk refresh", self.refresh_risk)

    @staticmethod
    def _step(name: str, fn) -> None:
        """Each step on its own, so one failing read (a lagging RPC node, say) does not skip the steps after it."""
        try:
            fn()
        except (httpx.HTTPError, OSError, RpcError) as e:
            log.warning("background %s: %s", name, e)
        except Exception:
            log.exception("background %s failed", name)

    def tail_events(self) -> None:
        """Ledger rows and submission updates may come from other processes; the SSE stream reads them here."""
        bus = self.services.bus
        for row in reversed(self.services.ledger.rows(after_id=self._ledger_seen, limit=500)):
            self._ledger_seen = max(self._ledger_seen, row["id"])
            bus.publish({"type": "ledger", "safe": row.get("safe"), "row": row})
        subs = self.services.db.query("SELECT id, safe, source, status, tx_hash, dar_hash, result, updated_at FROM "
                                      "submissions WHERE updated_at > ? ORDER BY updated_at", (self._subs_seen,))
        for sub in subs:
            self._subs_seen = max(self._subs_seen, sub["updated_at"])
            if sub["status"] == "confirmed":
                bus.publish({"type": "execution", "safe": sub["safe"], "source": sub["source"],
                             "txHash": sub["tx_hash"], "darHash": sub["dar_hash"], "result": sub["result"]})

    def refresh_risk(self) -> None:
        """Only Safes with an open SSE stream: a full snapshot per tenant every 10 s would not scale to 300."""
        watched = self.services.bus.watched_safes()
        for safe in self.services.safes:
            if safe.lower() not in watched:
                continue
            snap = self.services.snapshot(safe)
            self.services.record_triggers(safe, snap.risk, at=snap.state.timestamp)
            for v in snap.state.vaults:
                if v.quarantined:
                    self.workflow.drop_pending_deposits(safe, v.address)
            digest = str([(v.address, round(v.score, 3), [t.code for t in v.triggers], v.quarantined)
                          for v in snap.risk.vaults])
            if self._risk_cache.get(safe) != digest:
                self._risk_cache[safe] = digest
                self.services.bus.publish({"type": "risk", "safe": safe, "risk": snap.risk.to_json()})

    def start_background(self, interval: float = 1.0) -> None:
        def loop():
            while not self._stop.is_set():
                try:
                    self.tick()
                except (httpx.HTTPError, OSError) as e:
                    log.warning("background tick: %s", e)
                except Exception:
                    log.exception("background tick failed")
                self._stop.wait(interval)

        self._thread = threading.Thread(target=loop, name="aegis-background", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=5)
