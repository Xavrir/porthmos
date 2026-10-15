"""Tenants (docs/MULTI-TENANT.md): one row per Safe served by AEGIS, shared by all five processes.

Each process reads the table through a short cache, so a tenant activated by the API is picked up by the
Authorizer, Exit Agent, Executor and Keeper within `tenant_refresh` seconds without a restart.
"""

from __future__ import annotations

import threading
import time

from eth_utils import to_checksum_address

from aegis.db import Database

SERVED = "reference=1 OR activated_at IS NOT NULL"


class TenantStore:
    def __init__(self, db: Database, refresh: float = 3.0):
        self.db = db
        self.refresh = refresh
        self._lock = threading.Lock()
        self._rows: list[dict] | None = None
        self._loaded_at = 0.0

    def ensure_reference(self, safe: str, owner: str, bank: str) -> None:
        now = time.time()
        self.db.execute("INSERT OR IGNORE INTO tenants(safe, owner, bank, created_at, activated_at, reference) "
                        "VALUES (?, ?, ?, ?, ?, 1)",
                        (to_checksum_address(safe), to_checksum_address(owner), to_checksum_address(bank), now, now))
        self.invalidate()

    def invalidate(self) -> None:
        with self._lock:
            self._rows = None

    def served(self) -> list[dict]:
        with self._lock:
            if self._rows is None or time.monotonic() - self._loaded_at >= self.refresh:
                self._rows = self.db.query(f"SELECT * FROM tenants WHERE {SERVED} "
                                           "ORDER BY reference DESC, activated_at, safe")
                self._loaded_at = time.monotonic()
            return list(self._rows)

    def safes(self) -> list[str]:
        return [r["safe"] for r in self.served()]

    def served_get(self, safe: str) -> dict | None:
        return next((r for r in self.served() if r["safe"].lower() == safe.lower()), None)

    def get(self, safe: str) -> dict | None:
        return self.db.one("SELECT * FROM tenants WHERE lower(safe)=?", (safe.lower(),))

    def by_owner(self, address: str) -> list[dict]:
        return [r for r in self.served() if r["owner"].lower() == address.lower()]

    def by_bank(self, address: str) -> list[dict]:
        return [r for r in self.served() if r["bank"].lower() == address.lower()]

    def is_reference(self, safe: str) -> bool:
        row = self.served_get(safe)
        return bool(row and row["reference"])

    def activated_count(self) -> int:
        row = self.db.one("SELECT COUNT(*) AS n FROM tenants WHERE reference=0 AND activated_at IS NOT NULL")
        return int(row["n"]) if row else 0


def present(row: dict) -> dict:
    return {"safe": row["safe"], "owner": row["owner"], "bank": row["bank"], "reference": bool(row["reference"]),
            "createdAt": int(row["created_at"]),
            "activatedAt": int(row["activated_at"]) if row.get("activated_at") else None,
            "mintTx": row.get("mint_tx") if row.get("mint_tx") != "pending" else None}
