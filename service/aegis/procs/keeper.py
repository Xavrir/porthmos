"""Keeper: pushes the mock price every heartbeat (test infrastructure only)."""

from __future__ import annotations

import time

from aegis.services import Services

PAUSE_KEY = "keeper_paused"
LAST_POKE_KEY = "keeper_last_poke"


class Keeper:
    def __init__(self, services: Services, key: str):
        self.s = services
        self._key = key

    @property
    def paused(self) -> bool:
        return bool(self.s.db.kv_get(PAUSE_KEY, False))

    def tick(self) -> str | None:
        if self.paused:
            return None
        tx = self.s.chain.poke(self._key)
        self.s.db.kv_set(LAST_POKE_KEY, {"tx": tx, "at": int(time.time())})
        self.s.bus.publish({"type": "oracle", "safe": None, "poke": tx})
        return tx
