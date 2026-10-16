from __future__ import annotations

import json
import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY, role TEXT NOT NULL, address TEXT NOT NULL, safe TEXT,
  created_at REAL NOT NULL, expires_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS obligations (
  id TEXT PRIMARY KEY, safe TEXT NOT NULL, label TEXT NOT NULL, amount TEXT NOT NULL, due INTEGER NOT NULL,
  kind TEXT NOT NULL, confirmed INTEGER NOT NULL, settled INTEGER NOT NULL DEFAULT 0,
  created_at REAL NOT NULL, settled_at REAL
);
CREATE TABLE IF NOT EXISTS requests (
  id TEXT PRIMARY KEY, safe TEXT NOT NULL, role TEXT NOT NULL, state TEXT NOT NULL, message TEXT,
  data TEXT NOT NULL, created_at REAL NOT NULL, updated_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS requests_safe ON requests(safe, state);
CREATE TABLE IF NOT EXISTS transitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, request_id TEXT NOT NULL, from_state TEXT, to_state TEXT NOT NULL,
  at REAL NOT NULL, versions TEXT, note TEXT
);
CREATE INDEX IF NOT EXISTS transitions_req ON transitions(request_id);
CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY, ts REAL NOT NULL, safe TEXT, request_id TEXT, kind TEXT NOT NULL, payload TEXT NOT NULL,
  tx_hash TEXT, revert_reason TEXT, dar_hash TEXT, prev_hash TEXT NOT NULL, row_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL, op INTEGER NOT NULL, request_id TEXT,
  safe TEXT NOT NULL, vault TEXT NOT NULL, dar TEXT NOT NULL, sigs TEXT NOT NULL, approval TEXT,
  dar_hash TEXT NOT NULL, status TEXT NOT NULL, claimed_by TEXT, tx_hash TEXT, created_block INTEGER NOT NULL,
  created_at REAL NOT NULL, updated_at REAL NOT NULL, error TEXT, result TEXT, applied INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS submissions_status ON submissions(status);
CREATE TABLE IF NOT EXISTS risk_triggers (
  safe TEXT NOT NULL, vault TEXT NOT NULL, code TEXT NOT NULL, first_at REAL NOT NULL, last_at REAL NOT NULL,
  PRIMARY KEY (safe, vault, code)
);
CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts REAL NOT NULL, safe TEXT, vault TEXT, level TEXT NOT NULL,
  code TEXT NOT NULL, message TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tenants (
  safe TEXT PRIMARY KEY, owner TEXT NOT NULL, bank TEXT NOT NULL, created_at REAL NOT NULL, activated_at REAL,
  mint_tx TEXT, ip_hash TEXT, reference INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS tenants_owner ON tenants(owner);
CREATE INDEX IF NOT EXISTS tenants_bank ON tenants(bank);
CREATE TABLE IF NOT EXISTS faucet_drips (
  address TEXT PRIMARY KEY, amount TEXT NOT NULL, tx_hash TEXT, at REAL NOT NULL, day INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS rate_events (
  bucket TEXT NOT NULL, key TEXT NOT NULL, at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS rate_events_key ON rate_events(bucket, key, at);
CREATE TABLE IF NOT EXISTS tf_orders (
  order_id INTEGER PRIMARY KEY, buyer TEXT NOT NULL, supplier TEXT NOT NULL, total TEXT NOT NULL,
  terms_hash TEXT NOT NULL, created_at INTEGER NOT NULL, created_tx TEXT, created_block INTEGER,
  status TEXT NOT NULL, served INTEGER NOT NULL DEFAULT 1, refund_tx TEXT, obligation_id TEXT, seen_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS tf_orders_buyer ON tf_orders(buyer);
CREATE TABLE IF NOT EXISTS tf_milestones (
  order_id INTEGER NOT NULL, idx INTEGER NOT NULL, buyer TEXT NOT NULL, state TEXT NOT NULL, reason TEXT,
  request_id TEXT, data TEXT NOT NULL, updated_at REAL NOT NULL, PRIMARY KEY (order_id, idx)
);
CREATE INDEX IF NOT EXISTS tf_milestones_state ON tf_milestones(state);
CREATE TABLE IF NOT EXISTS tf_proofs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, idx INTEGER NOT NULL, proof_hash TEXT NOT NULL,
  proof TEXT NOT NULL, signature TEXT NOT NULL, document_hash TEXT, source TEXT NOT NULL, received_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS tf_proofs_milestone ON tf_proofs(order_id, idx);
CREATE TABLE IF NOT EXISTS tf_transitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, idx INTEGER NOT NULL, request_id TEXT,
  from_state TEXT, to_state TEXT NOT NULL, at REAL NOT NULL, note TEXT
);
CREATE INDEX IF NOT EXISTS tf_transitions_milestone ON tf_transitions(order_id, idx);
CREATE TABLE IF NOT EXISTS tf_confirmations (
  order_id INTEGER NOT NULL, idx INTEGER NOT NULL, proof_hash TEXT NOT NULL, expiry INTEGER NOT NULL,
  signature TEXT NOT NULL, signer TEXT NOT NULL, at REAL NOT NULL, PRIMARY KEY (order_id, idx, proof_hash)
);
CREATE TABLE IF NOT EXISTS signed_releases (
  auth_hash TEXT PRIMARY KEY, request_id TEXT, safe TEXT NOT NULL, order_id TEXT NOT NULL, idx INTEGER NOT NULL,
  nonce TEXT NOT NULL, signed_at REAL NOT NULL, auth TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS signed_dars (
  dar_hash TEXT PRIMARY KEY, request_id TEXT, safe TEXT NOT NULL, nonce TEXT NOT NULL, signed_at REAL NOT NULL,
  dar TEXT NOT NULL
);
"""


class Database:
    def __init__(self, path: str):
        if path != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        self._lock = threading.RLock()
        self.conn = sqlite3.connect(path, check_same_thread=False, isolation_level=None, timeout=30)
        self.conn.row_factory = sqlite3.Row
        if path != ":memory:":
            self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("PRAGMA busy_timeout=30000")
        self.conn.executescript(SCHEMA)

    @contextmanager
    def tx(self):
        """BEGIN IMMEDIATE takes the write lock up front, which serialises ledger appends across processes."""
        with self._lock:
            self.conn.execute("BEGIN IMMEDIATE")
            try:
                yield self.conn
            except BaseException:
                self.conn.execute("ROLLBACK")
                raise
            else:
                self.conn.execute("COMMIT")

    def execute(self, sql: str, params: tuple = ()) -> sqlite3.Cursor:
        with self._lock:
            return self.conn.execute(sql, params)

    def query(self, sql: str, params: tuple = ()) -> list[dict]:
        with self._lock:
            return [dict(r) for r in self.conn.execute(sql, params).fetchall()]

    def one(self, sql: str, params: tuple = ()) -> dict | None:
        rows = self.query(sql, params)
        return rows[0] if rows else None

    def kv_get(self, key: str, default=None):
        row = self.one("SELECT v FROM kv WHERE k=?", (key,))
        return json.loads(row["v"]) if row else default

    def kv_set(self, key: str, value) -> None:
        self.execute("INSERT INTO kv(k, v) VALUES(?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v",
                     (key, json.dumps(value)))
