"""Live event hub: fans out events (from MQTT thread or request threads) to WebSocket clients."""
from __future__ import annotations

import asyncio
import json
from typing import Any


class LiveHub:
    def __init__(self) -> None:
        self._loop: asyncio.AbstractEventLoop | None = None
        self._clients: set[asyncio.Queue] = set()

    def bind(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    @property
    def client_count(self) -> int:
        return len(self._clients)

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=500)
        self._clients.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        self._clients.discard(q)

    def _fanout(self, msg: str) -> None:
        for q in list(self._clients):
            try:
                q.put_nowait(msg)
            except asyncio.QueueFull:  # slow client: drop oldest
                try:
                    q.get_nowait()
                    q.put_nowait(msg)
                except Exception:
                    pass

    def publish(self, event: dict[str, Any]) -> None:
        """Thread-safe: may be called from any thread."""
        if self._loop is None or not self._clients:
            return
        msg = json.dumps(event, default=str)
        self._loop.call_soon_threadsafe(self._fanout, msg)


hub = LiveHub()
