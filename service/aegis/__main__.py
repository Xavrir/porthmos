"""Process entrypoints: python -m aegis {api|authorizer|exit_agent|executor|keeper|all}.

Each process loads only the key it owns (see config.load_key). `all` supervises the five in one container.
"""

from __future__ import annotations

import argparse
import logging
import logging.handlers
import os
import time

import httpx
import uvicorn

from aegis.config import load_key, load_settings
from aegis.db import Database

log = logging.getLogger("aegis")


def run_api() -> None:
    from aegis.api.app import create_app
    from aegis.runtime import Runtime

    settings = load_settings()
    rt = Runtime.build(settings)
    # Off by default outside Anvil: the SSE URL carries the session token as a query parameter.
    access_log = os.environ.get("API_ACCESS_LOG", "1" if settings.is_local_chain else "0") in ("1", "true", "yes")
    uvicorn.run(create_app(rt), host=settings.api_host, port=settings.api_port, log_level="info",
                access_log=access_log, proxy_headers=False, log_config=None)


def run_authorizer() -> None:
    from aegis.procs.authorizer import Authorizer, create_app
    from aegis.runtime import make_chain
    from aegis.services import register_reference
    from aegis.tenants import TenantStore

    settings = load_settings()
    chain = make_chain(settings)
    db = Database(os.environ.get("AUTHORIZER_DB", settings.db_path.replace(".db", "-authorizer.db")))
    tenants = TenantStore(Database(settings.db_path), settings.tenant_refresh)
    register_reference(tenants, settings, chain)
    auth = Authorizer(settings, chain, load_key("authorizer", settings.chain_id), db, tenants)
    log.info("authorizer %s on 127.0.0.1:%s", auth.address, settings.authorizer_port)
    uvicorn.run(create_app(auth, settings.internal_token), host="127.0.0.1", port=settings.authorizer_port,
                log_level="info", log_config=None)


def _services():
    from aegis.runtime import make_chain
    from aegis.services import Services

    settings = load_settings()
    return Services.create(settings, make_chain(settings))


def _loop(name: str, fn, interval: float) -> None:
    log.info("%s started", name)
    while True:
        try:
            fn()
        except (httpx.HTTPError, OSError) as e:
            log.warning("%s: %s", name, e)
        except Exception:
            log.exception("%s tick failed", name)
        time.sleep(interval)


def run_exit_agent() -> None:
    from aegis.procs.exit_agent import ExitAgent

    services = _services()
    settings = services.settings

    def notify(safe: str, vault: str) -> None:
        httpx.post(f"{settings.api_internal_url}/internal/quarantine", json={"safe": safe, "vault": vault},
                   headers={"X-Aegis-Internal": settings.internal_token}, timeout=5).raise_for_status()

    agent = ExitAgent(services, load_key("exitKey", settings.chain_id), notify=notify)
    log.info("exit agent %s watching %s", agent.address, services.safes)
    _loop("exit_agent", agent.tick, 1.0)


def run_executor() -> None:
    from aegis.procs.executor import Executor

    services = _services()
    withhold = ("exit_agent",) if services.settings.executor_withhold_exits else ()
    ex = Executor(services, load_key("executor", services.settings.chain_id), withhold)
    log.info("executor %s%s", ex.address, " (withholding exit DARs)" if withhold else "")
    _loop("executor", ex.tick, 1.0)


def run_keeper() -> None:
    from aegis.procs.keeper import Keeper

    services = _services()
    keeper = Keeper(services, load_key("keeper", services.settings.chain_id))
    interval = services.settings.params.keeper_interval
    last = 0.0

    def tick():
        nonlocal last
        if time.time() - last >= interval:
            tx = keeper.tick()
            last = time.time()
            if tx:
                log.info("poke %s", tx)

    _loop("keeper", tick, 1.0)


def setup_logging(process: str) -> None:
    fmt = f"%(asctime)s {process} %(name)s %(levelname)s %(message)s"
    logging.basicConfig(level=logging.INFO, format=fmt)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    log_dir = os.environ.get("AEGIS_LOG_DIR")
    if log_dir:
        os.makedirs(log_dir, exist_ok=True)
        handler = logging.handlers.RotatingFileHandler(os.path.join(log_dir, f"{process}.log"),
                                                       maxBytes=5_000_000, backupCount=3)
        handler.setFormatter(logging.Formatter(fmt))
        logging.getLogger().addHandler(handler)


def main() -> None:
    from aegis.supervisor import run_all

    parser = argparse.ArgumentParser(prog="aegis")
    parser.add_argument("process", choices=["api", "authorizer", "exit_agent", "executor", "keeper", "all"])
    args = parser.parse_args()
    setup_logging("supervisor" if args.process == "all" else args.process)
    {"api": run_api, "authorizer": run_authorizer, "exit_agent": run_exit_agent, "executor": run_executor,
     "keeper": run_keeper, "all": run_all}[args.process]()


if __name__ == "__main__":
    main()
