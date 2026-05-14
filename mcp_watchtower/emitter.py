"""Event emission pipeline."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from .bus import EventBus
from .events import EventDict, normalize_event
from .storage import SQLiteStore

if TYPE_CHECKING:
    from .redaction import Redactor
    from .webhooks import WebhookDispatcher


class EventEmitter:
    def __init__(
        self,
        run_id: str,
        store: SQLiteStore,
        bus: EventBus,
        redactor: "Redactor | None" = None,
        exporters: "list[Any] | None" = None,
        webhook_dispatcher: "WebhookDispatcher | None" = None,
    ) -> None:
        self.run_id = run_id
        self.store = store
        self.bus = bus
        self._redactor = redactor
        self._exporters = exporters or []
        self._webhook_dispatcher = webhook_dispatcher

    async def emit(self, payload: EventDict) -> EventDict:
        event = normalize_event(self.run_id, payload).to_dict()

        # Scrub secrets before anything hits SQLite or the SSE stream.
        if self._redactor is not None:
            event = self._redactor.scrub(event)

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
            await self.bus.register_approval(event["approval_id"])
        elif event["type"] in {"tool_call_approved", "tool_call_rejected"} and event.get("approval_id"):
            decision = "approved" if event["type"] == "tool_call_approved" else "rejected"
            await self.bus.signal_approval(event["approval_id"], decision)
        elif event["type"] in {"tool_call_completed", "tool_call_failed", "tool_call_timeout"}:
            self.store.record_tool_event(event)

        await self.bus.publish(self.run_id, event)

        # Fire exporters (sync, best-effort)
        for exporter in self._exporters:
            try:
                exporter.on_event(event)
            except Exception:
                pass

        # Fire webhooks (sync, fire-and-forget, no blocking)
        if self._webhook_dispatcher is not None:
            self._webhook_dispatcher.dispatch(event)

        return event
