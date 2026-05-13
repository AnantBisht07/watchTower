"""Event primitives for MCP Watchtower."""

from __future__ import annotations

import warnings
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4


EventDict = dict[str, Any]

KNOWN_EVENT_TYPES: frozenset[str] = frozenset(
    {
        "run_started",
        "run_completed",
        "run_failed",
        "agent_started",
        "agent_step_started",
        "agent_step_completed",
        "agent_completed",
        "agent_failed",
        "health_check_started",
        "health_check_completed",
        "health_check_failed",
        "tools_discovered",
        "tool_call_requested",
        "tool_call_started",
        "tool_call_completed",
        "tool_call_failed",
        "tool_call_timeout",
        "tool_call_approved",
        "tool_call_rejected",
        "approval_required",
    }
)


def utc_now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex[:12]}"


@dataclass(slots=True)
class WatchtowerEvent:
    """Normalized event payload stored and streamed by Watchtower."""

    type: str
    run_id: str
    status: str
    message: str
    event_id: str = field(default_factory=lambda: new_id("evt"))
    timestamp: str = field(default_factory=utc_now_iso)
    parent_event_id: str | None = None
    server: str | None = None
    transport: str | None = None
    tool: str | None = None
    input: Any | None = None
    output_summary: Any | None = None
    latency_ms: int | None = None
    risk: str | None = None
    approval_id: str | None = None
    reason: str | None = None
    error: Any | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> EventDict:
        data: EventDict = {
            "event_id": self.event_id,
            "run_id": self.run_id,
            "parent_event_id": self.parent_event_id,
            "type": self.type,
            "timestamp": self.timestamp,
            "status": self.status,
            "message": self.message,
            "metadata": self.metadata,
        }
        optional = {
            "server": self.server,
            "transport": self.transport,
            "tool": self.tool,
            "input": self.input,
            "output_summary": self.output_summary,
            "latency_ms": self.latency_ms,
            "risk": self.risk,
            "approval_id": self.approval_id,
            "reason": self.reason,
            "error": self.error,
        }
        for key, value in optional.items():
            if value is not None:
                data[key] = value
        return data


def normalize_event(run_id: str, payload: EventDict, strict: bool = False) -> WatchtowerEvent:
    required = ("type", "status", "message")
    missing = [key for key in required if not payload.get(key)]
    if missing:
        joined = ", ".join(missing)
        raise ValueError(f"event payload missing required field(s): {joined}")

    event_type = payload["type"]
    if event_type not in KNOWN_EVENT_TYPES:
        msg = f"unknown event type '{event_type}' — add it to KNOWN_EVENT_TYPES if intentional"
        if strict:
            raise ValueError(msg)
        warnings.warn(msg, stacklevel=3)

    return WatchtowerEvent(
        event_id=payload.get("event_id") or new_id("evt"),
        run_id=payload.get("run_id") or run_id,
        parent_event_id=payload.get("parent_event_id"),
        type=payload["type"],
        timestamp=payload.get("timestamp") or utc_now_iso(),
        status=payload["status"],
        message=payload["message"],
        server=payload.get("server"),
        transport=payload.get("transport"),
        tool=payload.get("tool"),
        input=payload.get("input"),
        output_summary=payload.get("output_summary"),
        latency_ms=payload.get("latency_ms"),
        risk=payload.get("risk"),
        approval_id=payload.get("approval_id"),
        reason=payload.get("reason"),
        error=payload.get("error"),
        metadata=payload.get("metadata") or {},
    )


def summarize_output(value: Any) -> dict[str, Any]:
    if value is None:
        return {"type": "none"}
    if isinstance(value, list):
        return {"type": "list", "count": len(value)}
    if isinstance(value, tuple):
        return {"type": "tuple", "count": len(value)}
    if isinstance(value, dict):
        return {"type": "object", "keys": list(value.keys())[:20]}
    if isinstance(value, str):
        return {"type": "string", "length": len(value), "preview": value[:200]}
    return {"type": type(value).__name__}
