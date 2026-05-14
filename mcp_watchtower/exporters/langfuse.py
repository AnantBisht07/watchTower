"""Langfuse exporter for Watchtower events.

Install:
    pip install mcp-watchtower[langfuse]

Usage:
    from mcp_watchtower.exporters.langfuse import LangfuseExporter
    from mcp_watchtower import Watchtower

    exporter = LangfuseExporter(
        public_key="pk-...",
        secret_key="sk-...",
        host="https://cloud.langfuse.com",  # or your self-hosted URL
    )

    watchtower = Watchtower(app_name="my-agent")
    watchtower.add_exporter(exporter)
"""

from __future__ import annotations

from typing import Any


class LangfuseExporter:
    """Maps Watchtower tool events to Langfuse generations/spans."""

    def __init__(
        self,
        public_key: str,
        secret_key: str,
        host: str = "https://cloud.langfuse.com",
    ) -> None:
        try:
            from langfuse import Langfuse
        except ImportError:
            raise ImportError(
                "langfuse package is missing.\n"
                "Install with: pip install mcp-watchtower[langfuse]"
            )
        self._lf = Langfuse(public_key=public_key, secret_key=secret_key, host=host)
        # event_id -> Langfuse span
        self._spans: dict[str, Any] = {}
        # run_id -> Langfuse trace
        self._traces: dict[str, Any] = {}

    def on_event(self, event: dict[str, Any]) -> None:
        event_type = event.get("type", "")
        run_id = event.get("run_id", "")
        event_id = event.get("event_id", "")
        parent_id = event.get("parent_event_id")

        if event_type == "run_started":
            trace = self._lf.trace(
                id=run_id,
                name=event.get("message", "mcp-run"),
                metadata=event.get("metadata"),
            )
            self._traces[run_id] = trace

        elif event_type == "tool_call_started":
            trace = self._traces.get(run_id)
            if trace is None:
                return
            span = trace.span(
                name=f"{event.get('server', 'unknown')}.{event.get('tool', 'unknown')}",
                input=event.get("input"),
                metadata={"risk": event.get("risk"), "server": event.get("server")},
            )
            self._spans[event_id] = span

        elif event_type in {"tool_call_completed", "tool_call_failed", "tool_call_timeout"}:
            span = self._spans.pop(parent_id or event_id, None)
            if span is None:
                return
            span.end(
                output=event.get("output_summary"),
                level="DEFAULT" if event_type == "tool_call_completed" else "ERROR",
                status_message=str(event.get("error", "")) if event_type != "tool_call_completed" else None,
            )

        elif event_type in {"run_completed", "run_failed"}:
            trace = self._traces.pop(run_id, None)
            if trace:
                self._lf.flush()
