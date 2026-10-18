from __future__ import annotations

import logging
import time
from dataclasses import dataclass

from aegis.chain.base import ChainClient
from aegis.config import Settings
from aegis.core.pipeline import Snapshot, snapshot
from aegis.core.risk import RiskReport
from aegis.core.state import TreasuryState
from aegis.db import Database
from aegis.events import EventBus
from aegis.ledger import Ledger
from aegis.limits import RateLimiter
from aegis.obligations import ObligationStore
from aegis.tenants import TenantStore

log = logging.getLogger("aegis")


@dataclass
class Services:
    settings: Settings
    chain: ChainClient
    db: Database
    ledger: Ledger
    obligations: ObligationStore
    bus: EventBus
    tenants: TenantStore
    limiter: RateLimiter

    @classmethod
    def create(cls, settings: Settings, chain: ChainClient, db: Database | None = None,
               bus: EventBus | None = None) -> "Services":
        db = db or Database(settings.db_path)
        bus = bus or EventBus()
        ledger = Ledger(db)
        tenants = TenantStore(db, settings.tenant_refresh)
        register_reference(tenants, settings, chain)
        return cls(settings, chain, db, ledger, ObligationStore(db), bus, tenants, RateLimiter(db))

    @property
    def safes(self) -> list[str]:
        """The reference Safe(s) from the deployments file plus every activated tenant."""
        return self.tenants.safes()

    def known_safe(self, safe: str) -> str | None:
        return next((s for s in self.safes if s.lower() == safe.lower()), None)

    def last_triggers(self, safe: str) -> dict[str, float]:
        rows = self.db.query("SELECT vault, MAX(last_at) AS last FROM risk_triggers WHERE safe=? GROUP BY vault",
                             (safe.lower(),))
        return {r["vault"]: r["last"] for r in rows}

    def record_triggers(self, safe: str, risk: RiskReport, at: float | None = None) -> None:
        at = at or time.time()
        for v in risk.vaults:
            for t in v.triggers:
                self.db.execute(
                    "INSERT INTO risk_triggers(safe, vault, code, first_at, last_at) VALUES (?, ?, ?, ?, ?) "
                    "ON CONFLICT(safe, vault, code) DO UPDATE SET last_at=excluded.last_at",
                    (safe.lower(), v.address.lower(), t.code, at, at))

    def snapshot(self, safe: str, state: TreasuryState | None = None) -> Snapshot:
        return snapshot(self.chain, self.settings, safe, self.obligations.list(safe, include_settled=False),
                        self.last_triggers(safe), state)

    def alert(self, level: str, code: str, message: str, safe: str | None = None, vault: str | None = None) -> None:
        self.db.execute("INSERT INTO alerts(ts, safe, vault, level, code, message) VALUES (?, ?, ?, ?, ?, ?)",
                        (time.time(), safe.lower() if safe else None, vault, level, code, message))
        self.bus.publish({"type": "alert", "safe": safe, "level": level, "code": code, "message": message,
                          "vault": vault})


def register_reference(tenants: TenantStore, settings: Settings, chain: ChainClient) -> None:
    """Tenant zero: the deployments-file Safe. Owner and bank come from the registry, else from the file's roles."""
    roles = settings.addresses.roles
    for safe in settings.addresses.safes:
        if tenants.get(safe):
            continue
        owner, bank = roles.get("owner"), roles.get("bank")
        try:
            pol = chain.policy(safe, [])
            owner, bank = pol.owner, pol.bank
        except Exception as e:
            log.warning("reference Safe %s: registry read failed (%s); using deployment roles", safe, e)
        if owner and bank:
            tenants.ensure_reference(safe, owner, bank)
