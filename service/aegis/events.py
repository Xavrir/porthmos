"""In-process event bus feeding the SSE stream. Publish is thread-safe; subscribers are asyncio queues."""

from __future__ import annotations

import asyncio
import itertools
import threading
import time


class EventBus:
    def __init__(self):
        self._subs: dict[int, tuple[asyncio.AbstractEventLoop, asyncio.Queue, str | None]] = {}
        self._ids = itertools.count(1)
        self._lock = threading.Lock()
        self.recent: list[dict] = []

    def subscribe(self, safe: str | None) -> tuple[int, asyncio.Queue]:
        """safe=None subscribes to every Safe (bank session)."""
        loop = asyncio.get_running_loop()
        q: asyncio.Queue = asyncio.Queue(maxsize=1000)
        sid = next(self._ids)
        with self._lock:
            self._subs[sid] = (loop, q, safe.lower() if safe else None)
        return sid, q

    def unsubscribe(self, sid: int) -> None:
        with self._lock:
            self._subs.pop(sid, None)

    def publish(self, event: dict) -> None:
        event = {"ts": round(time.time(), 3), **event}
        with self._lock:
            self.recent = (self.recent + [event])[-200:]
            subs = list(self._subs.values())
        safe = (event.get("safe") or "").lower() or None
        for loop, q, scope in subs:
            if scope is not None and safe is not None and scope != safe:
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
