"""`python -m aegis all`: runs the five processes in one container.

Each child gets only the secrets its role needs (as scripts/dev.sh does), is restarted with backoff if it
exits, and receives SIGTERM when the supervisor does.
"""

from __future__ import annotations

import logging
import os
import signal
import subprocess
import sys
import time
from dataclasses import dataclass

log = logging.getLogger("aegis.supervisor")

ISSUER_KEYS = ("ISSUER_CARRIER_KEY", "ISSUER_SENSOR_KEY", "ISSUER_SURVEYOR_KEY")
SECRETS = ("AUTHORIZER_KEY", "EXIT_KEY", "EXECUTOR_KEY", "KEEPER_KEY", "ADMIN_KEY", "DEPLOYER_KEY", "ATTACKER_KEY",
           "LLM_API_KEY", "ADMIN_TOKEN", "INTERNAL_TOKEN", *ISSUER_KEYS)
OWNED = {
    "authorizer": ("AUTHORIZER_KEY", "INTERNAL_TOKEN"),
    "api": ("ADMIN_KEY", "DEPLOYER_KEY", "ATTACKER_KEY", "LLM_API_KEY", "ADMIN_TOKEN", "INTERNAL_TOKEN", *ISSUER_KEYS),
    "executor": ("EXECUTOR_KEY",),
    "exit_agent": ("EXIT_KEY", "INTERNAL_TOKEN"),
    "keeper": ("KEEPER_KEY",),
}
ORDER = ("authorizer", "api", "executor", "exit_agent", "keeper")
MAX_BACKOFF = 30.0
HEALTHY_AFTER = 60.0
STOP_GRACE = 10.0


def child_env(name: str, base: dict[str, str]) -> dict[str, str]:
    env = {k: v for k, v in base.items() if k not in SECRETS or k in OWNED[name]}
    env["PYTHONUNBUFFERED"] = "1"
    return env


@dataclass
class Child:
    name: str
    proc: subprocess.Popen | None = None
    started: float = 0.0
    backoff: float = 1.0
    restart_at: float = 0.0
    restarts: int = 0


class Supervisor:
    def __init__(self, names=ORDER, env: dict[str, str] | None = None):
        self.env = dict(env if env is not None else os.environ)
        self.children = [Child(n) for n in names]
        self.stopping = False

    def spawn(self, child: Child) -> None:
        child.proc = subprocess.Popen([sys.executable, "-m", "aegis", child.name], env=child_env(child.name, self.env))
        child.started = time.monotonic()
        log.info("started %s (pid %s)", child.name, child.proc.pid)

    def stop(self, *_):
        self.stopping = True

    def run(self) -> int:
        signal.signal(signal.SIGTERM, self.stop)
        signal.signal(signal.SIGINT, self.stop)
        for child in self.children:
            self.spawn(child)
        while not self.stopping:
            self.check()
            time.sleep(0.5)
        return self.shutdown()

    def check(self) -> None:
        now = time.monotonic()
        for child in self.children:
            if child.proc is None:
                if now >= child.restart_at:
                    self.spawn(child)
                continue
            code = child.proc.poll()
            if code is None:
                if now - child.started > HEALTHY_AFTER:
                    child.backoff = 1.0
                continue
            child.restarts += 1
            log.warning("%s exited with %s; restarting in %.0f s", child.name, code, child.backoff)
            child.proc = None
            child.restart_at = now + child.backoff
            child.backoff = min(child.backoff * 2, MAX_BACKOFF)

    def shutdown(self) -> int:
        live = [c.proc for c in self.children if c.proc is not None and c.proc.poll() is None]
        for proc in live:
            proc.send_signal(signal.SIGTERM)
        deadline = time.monotonic() + STOP_GRACE
        for proc in live:
            try:
                proc.wait(timeout=max(0.1, deadline - time.monotonic()))
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()
        log.info("all processes stopped")
        return 0


def run_all() -> None:
    sys.exit(Supervisor().run())
