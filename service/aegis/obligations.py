from __future__ import annotations

import time
import uuid
from datetime import UTC, datetime

from aegis.chain.base import ChainClient
from aegis.config import Params
from aegis.core.reserve import Obligation, required_reserve
from aegis.db import Database
from aegis.units import amount


def parse_due(value) -> int:
    if isinstance(value, (int, float)):
        return int(value)
    text = str(value).strip()
    if text.isdigit():
        return int(text)
    if len(text) == 10:
        dt = datetime.strptime(text, "%Y-%m-%d").replace(tzinfo=UTC)
    else:
        dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=UTC)
    return int(dt.timestamp())


def iso(ts: int) -> str:
    return datetime.fromtimestamp(ts, UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


class ObligationStore:
    def __init__(self, db: Database):
        self.db = db

    def list(self, safe: str, include_settled: bool = True) -> list[Obligation]:
        rows = self.db.query("SELECT * FROM obligations WHERE safe=? ORDER BY due, id", (safe.lower(),))
        out = [Obligation(r["id"], r["label"], int(r["amount"]), r["due"], r["kind"], bool(r["confirmed"]),
                          bool(r["settled"])) for r in rows]
        return out if include_settled else [o for o in out if not o.settled]

    def add(self, safe: str, label: str, amount_raw: int, due: int, inflow: bool = False) -> Obligation:
        ob = Obligation(f"obl_{uuid.uuid4().hex[:12]}", label[:120], amount_raw, due,
                        "inflow" if inflow else "outflow", True, False)
        self.db.execute(
            "INSERT INTO obligations(id, safe, label, amount, due, kind, confirmed, settled, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)",
            (ob.id, safe.lower(), ob.label, str(ob.amount), ob.due, ob.kind, 1, time.time()))
        return ob

    def settle(self, safe: str, obligation_id: str) -> Obligation | None:
        cur = self.db.execute("UPDATE obligations SET settled=1, settled_at=? WHERE id=? AND safe=? AND settled=0",
                              (time.time(), obligation_id, safe.lower()))
        if cur.rowcount == 0:
            return None
        return next((o for o in self.list(safe) if o.id == obligation_id), None)


def to_json(o: Obligation) -> dict:
    return {
        "id": o.id, "label": o.label, "amount": amount(o.amount), "dueDate": iso(o.due),
        "confirmedInflow": o.is_inflow and o.confirmed, "kind": o.kind, "settled": o.settled,
    }


def floor_update(chain: ChainClient, safe: str, obligations: list[Obligation], now: int, params: Params) -> dict:
    """The owner-signed setReserveFloor(ceil(R_required), scheduleHash) transaction for the wallet."""
    res = required_reserve(obligations, now, params)
    tx = chain.encode_set_reserve_floor(safe, res.required, res.schedule_hash)
    return {**tx, "floor": amount(res.required), "scheduleHash": res.schedule_hash}
