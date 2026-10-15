"""In-process event bus feeding the SSE stream. Publish is thread-safe; subscribers are asyncio queues."""

from __future__ import annotations

import asyncio
import itertools
import threading
import time


class EventBus:
    """Events carrying a `safe` reach only subscribers scoped to that Safe; events without one are market-wide."""

    def __init__(self):
        self._subs: dict[int, tuple[asyncio.AbstractEventLoop, asyncio.Queue, frozenset[str]]] = {}
        self._ids = itertools.count(1)
        self._lock = threading.Lock()

    def subscribe(self, safes) -> tuple[int, asyncio.Queue]:
        loop = asyncio.get_running_loop()
        q: asyncio.Queue = asyncio.Queue(maxsize=1000)
        sid = next(self._ids)
        with self._lock:
            self._subs[sid] = (loop, q, frozenset(s.lower() for s in safes))
        return sid, q

    def unsubscribe(self, sid: int) -> None:
        with self._lock:
            self._subs.pop(sid, None)

    def watched_safes(self) -> set[str]:
        with self._lock:
            return set().union(*(scope for _, _, scope in self._subs.values()))

    def publish(self, event: dict) -> None:
        event = {"ts": round(time.time(), 3), **event}
        with self._lock:
            subs = list(self._subs.values())
        safe = str(event.get("safe") or "").lower() or None
        for loop, q, scope in subs:
            if safe is not None and safe not in scope:
                continue
            try:
                loop.call_soon_threadsafe(_put, q, event)
            except RuntimeError:
                pass


def _put(q: asyncio.Queue, event: dict) -> None:
    if q.full():
        try:
            q.get_nowait()
        except asyncio.QueueEmpty:
            pass
    q.put_nowait(event)
