"""Sliding-window rate limits kept in the shared SQLite file, so they survive restarts."""

from __future__ import annotations

import time

from aegis.db import Database


class RateLimiter:
    def __init__(self, db: Database):
        self.db = db

    def hit(self, bucket: str, key: str, limit: int, window: float) -> bool:
        """Record one event and return True, or return False without recording if the limit is reached."""
        now = time.time()
        with self.db.tx() as conn:
            conn.execute("DELETE FROM rate_events WHERE bucket=? AND key=? AND at<=?", (bucket, key, now - window))
            n = conn.execute("SELECT COUNT(*) FROM rate_events WHERE bucket=? AND key=? AND at>?",
                             (bucket, key, now - window)).fetchone()[0]
            if n >= limit:
                return False
            conn.execute("INSERT INTO rate_events(bucket, key, at) VALUES (?, ?, ?)", (bucket, key, now))
            return True

    def count(self, bucket: str, key: str, window: float) -> int:
        row = self.db.one("SELECT COUNT(*) AS n FROM rate_events WHERE bucket=? AND key=? AND at>?",
                          (bucket, key, time.time() - window))
        return int(row["n"]) if row else 0
