"""Hash-chained Decision Ledger and reconciliation against AegisExecuted events."""

from __future__ import annotations

import hashlib
import json
import time

from aegis.db import Database

GENESIS = "0" * 64
EXECUTION_KINDS = ("CONFIRMED", "EXIT_CONFIRMED")


def canonical(obj) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), default=str)


def row_digest(row: dict) -> str:
    body = {k: row.get(k) for k in (
        "id", "ts", "safe", "request_id", "kind", "payload", "tx_hash", "revert_reason", "dar_hash", "prev_hash")}
    return hashlib.sha256(canonical(body).encode()).hexdigest()


class Ledger:
    def __init__(self, db: Database, on_append=None):
        self.db = db
        self.on_append = on_append

    def append(self, kind: str, safe: str | None, payload: dict, request_id: str | None = None,
               tx_hash: str | None = None, revert_reason: str | None = None, dar_hash: str | None = None) -> dict:
        with self.db.tx() as conn:
            last = conn.execute("SELECT id, row_hash FROM ledger ORDER BY id DESC LIMIT 1").fetchone()
            row = {
                "id": (last["id"] + 1) if last else 1,
                "ts": round(time.time(), 3),
                "safe": safe.lower() if safe else None,
                "request_id": request_id,
                "kind": kind,
                "payload": canonical(payload),
                "tx_hash": tx_hash,
                "revert_reason": revert_reason,
                "dar_hash": dar_hash,
                "prev_hash": last["row_hash"] if last else GENESIS,
            }
            row["row_hash"] = row_digest(row)
            conn.execute(
                "INSERT INTO ledger(id, ts, safe, request_id, kind, payload, tx_hash, revert_reason, dar_hash, "
                "prev_hash, row_hash) VALUES (:id, :ts, :safe, :request_id, :kind, :payload, :tx_hash, "
                ":revert_reason, :dar_hash, :prev_hash, :row_hash)", row)
        out = present(row)
        if self.on_append:
            self.on_append(out)
        return out

    def rows(self, safe: str | None = None, limit: int = 200, after_id: int = 0) -> list[dict]:
        if safe:
            rows = self.db.query("SELECT * FROM ledger WHERE safe=? AND id>? ORDER BY id DESC LIMIT ?",
                                 (safe.lower(), after_id, limit))
        else:
            rows = self.db.query("SELECT * FROM ledger WHERE id>? ORDER BY id DESC LIMIT ?", (after_id, limit))
        return [present(r) for r in rows]

    def verify(self) -> dict:
        """Recompute the chain. Returns broken row ids; an edited, inserted or deleted row breaks the chain."""
        rows = self.db.query("SELECT * FROM ledger ORDER BY id ASC")
        broken: list[dict] = []
        prev = GENESIS
        expected_id = 1
        for r in rows:
            problems = []
            if r["id"] != expected_id:
                problems.append("gap")
            if r["prev_hash"] != prev:
                problems.append("prev_hash")
            if row_digest(r) != r["row_hash"]:
                problems.append("row_hash")
            if problems:
                broken.append({"id": r["id"], "safe": r["safe"], "problems": problems})
            prev = r["row_hash"]
            expected_id = r["id"] + 1
        return {"ok": not broken, "rows": len(rows), "broken": broken}


def present(row: dict) -> dict:
    out = dict(row)
    try:
        out["payload"] = json.loads(row["payload"])
    except (TypeError, ValueError):
        pass
    return out


def reconcile(ledger: Ledger, events: list[dict], safe: str) -> dict:
    """Compare ledger execution rows with on-chain AegisExecuted events for one Safe.

    Counts: events with no ledger row (hidden activity), ledger executions with no event (fabricated
    rows), amount disagreements, and broken hash-chain rows attributable to this Safe.
    """
    safe_l = safe.lower()
    chain = {e["darHash"].lower(): e for e in events
             if e.get("event") == "AegisExecuted" and e["safe"].lower() == safe_l}
    rows = [r for r in ledger.rows(safe_l, limit=100_000) if r["kind"] in EXECUTION_KINDS and r.get("dar_hash")]
    led = {r["dar_hash"].lower(): r for r in rows}
    details: list[dict] = []
    for h, e in chain.items():
        if h not in led:
            details.append({"type": "event_without_ledger_row", "darHash": h, "txHash": e.get("txHash")})
    for h, r in led.items():
        e = chain.get(h)
        if e is None:
            details.append({"type": "ledger_row_without_event", "darHash": h, "ledgerId": r["id"]})
            continue
        payload = r["payload"] if isinstance(r["payload"], dict) else {}
        for k in ("assets", "shares"):
            if k in payload and str(payload[k]) != str(e[k]):
                details.append({"type": "amount_mismatch", "darHash": h, "field": k, "ledger": payload[k],
                                "chain": e[k], "ledgerId": r["id"]})
    integrity = ledger.verify()
    for b in integrity["broken"]:
        if b["safe"] in (safe_l, None):
            details.append({"type": "ledger_integrity", "ledgerId": b["id"], "problems": b["problems"]})
    if not integrity["ok"] and not any(d["type"] == "ledger_integrity" for d in details):
        details.append({"type": "ledger_integrity", "ledgerId": integrity["broken"][0]["id"],
                        "problems": ["chain broken elsewhere"]})
    return {"safe": safe, "mismatches": len(details), "details": details, "ledgerIntegrity": integrity["ok"],
            "chainExecutions": len(chain), "ledgerExecutions": len(led)}
