"""Keeper: pushes the mock price every heartbeat (test infrastructure only)."""

from __future__ import annotations

from aegis.services import Services

PAUSE_KEY = "keeper_paused"


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
        self.s.bus.publish({"type": "oracle", "safe": None, "poke": tx})
        return tx
