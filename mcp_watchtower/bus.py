"""In-memory pub/sub bus for live run updates and approval signaling."""

from __future__ import annotations

import asyncio
from collections import defaultdict
from typing import Any


class EventBus:
    def __init__(self) -> None:
        self._subscribers: dict[str, set[asyncio.Queue[dict[str, Any]]]] = defaultdict(set)
        self._lock = asyncio.Lock()
        # approval_id -> asyncio.Event signaled when a decision arrives
        self._approval_events: dict[str, asyncio.Event] = {}
        self._approval_statuses: dict[str, str] = {}
        self._approval_lock = asyncio.Lock()

    async def publish(self, run_id: str, event: dict[str, Any]) -> None:
        async with self._lock:
            subscribers = list(self._subscribers.get(run_id, set()))
        for queue in subscribers:
            await queue.put(event)

    async def subscribe(self, run_id: str) -> asyncio.Queue[dict[str, Any]]:
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        async with self._lock:
            self._subscribers[run_id].add(queue)
        return queue

    async def unsubscribe(self, run_id: str, queue: asyncio.Queue[dict[str, Any]]) -> None:
        async with self._lock:
            subscribers = self._subscribers.get(run_id)
            if not subscribers:
                return
            subscribers.discard(queue)
            if not subscribers:
                self._subscribers.pop(run_id, None)

    # ------------------------------------------------------------------
    # Approval signaling — replaces the SQLite polling loop
    # ------------------------------------------------------------------

    async def register_approval(self, approval_id: str) -> None:
        """Register a pending approval so wait_for_approval can block on it."""
        async with self._approval_lock:
            if approval_id not in self._approval_events:
                self._approval_events[approval_id] = asyncio.Event()

    async def signal_approval(self, approval_id: str, status: str) -> None:
        """Called by EventEmitter when a decision event is persisted."""
        async with self._approval_lock:
            self._approval_statuses[approval_id] = status
            event = self._approval_events.get(approval_id)
        if event is not None:
            event.set()

    async def wait_for_approval(self, approval_id: str, timeout: float) -> str:
        """Block until the approval is decided or timeout expires.

        Returns the decision status string ("approved" or "rejected"),
        or "timeout" if no decision arrived in time.
        """
        async with self._approval_lock:
            event = self._approval_events.get(approval_id)
        if event is None:
            # Approval was signaled before we started waiting — check status.
            async with self._approval_lock:
                return self._approval_statuses.get(approval_id, "timeout")

        try:
            await asyncio.wait_for(event.wait(), timeout=timeout)
        except asyncio.TimeoutError:
            return "timeout"

        async with self._approval_lock:
            return self._approval_statuses.get(approval_id, "timeout")

    async def cleanup_approval(self, approval_id: str) -> None:
        async with self._approval_lock:
            self._approval_events.pop(approval_id, None)
            self._approval_statuses.pop(approval_id, None)
