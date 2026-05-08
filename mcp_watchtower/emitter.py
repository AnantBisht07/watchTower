"""Event emission pipeline."""

from __future__ import annotations

from .bus import EventBus
from .events import EventDict, normalize_event
from .storage import SQLiteStore


class EventEmitter:
    def __init__(self, run_id: str, store: SQLiteStore, bus: EventBus) -> None:
        self.run_id = run_id
        self.store = store
        self.bus = bus

    async def emit(self, payload: EventDict) -> EventDict:
        event = normalize_event(self.run_id, payload).to_dict()
        self.store.append_event(event)

        if event["type"] == "run_completed":
            self.store.update_run_status(self.run_id, "completed")
        elif event["type"] in {"run_failed", "agent_failed"}:
            self.store.update_run_status(self.run_id, "failed")
        elif event["type"] == "approval_required" and event.get("approval_id"):
            self.store.create_approval(
                run_id=self.run_id,
                approval_id=event["approval_id"],
                event_id=event["event_id"],
                risk=event.get("risk"),
                reason=event.get("reason") or event["message"],
            )
        elif event["type"] in {"tool_call_completed", "tool_call_failed", "tool_call_timeout"}:
            self.store.record_tool_event(event)

        await self.bus.publish(self.run_id, event)
        return event
