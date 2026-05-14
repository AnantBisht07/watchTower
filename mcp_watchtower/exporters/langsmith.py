"""LangSmith exporter for Watchtower events.

Install:
    pip install mcp-watchtower[langsmith]

Usage:
    from mcp_watchtower.exporters.langsmith import LangSmithExporter
    from mcp_watchtower import Watchtower

    exporter = LangSmithExporter(
        api_key="ls__...",
        project_name="my-project",
    )

    watchtower = Watchtower(app_name="my-agent")
    watchtower.add_exporter(exporter)
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any


class LangSmithExporter:
    """Maps Watchtower tool events to LangSmith runs."""

    def __init__(self, api_key: str, project_name: str = "default") -> None:
        try:
            from langsmith import Client
        except ImportError:
            raise ImportError(
                "langsmith package is missing.\n"
                "Install with: pip install mcp-watchtower[langsmith]"
            )
        self._client = Client(api_key=api_key)
        self._project = project_name
        # event_id -> LangSmith run_id (UUID)
        self._run_ids: dict[str, str] = {}
        # watchtower run_id -> LangSmith root run_id
        self._root_ids: dict[str, str] = {}

    def on_event(self, event: dict[str, Any]) -> None:
        event_type = event.get("type", "")
        wt_run_id = event.get("run_id", "")
        event_id = event.get("event_id", "")
        parent_id = event.get("parent_event_id")

        if event_type == "run_started":
            root_id = str(uuid.uuid4())
            self._root_ids[wt_run_id] = root_id
            self._client.create_run(
                id=root_id,
                name=event.get("message", "mcp-run"),
                run_type="chain",
                project_name=self._project,
                inputs={"task": event.get("metadata", {}).get("task", "")},
                start_time=datetime.now(UTC),
            )

        elif event_type == "tool_call_started":
            root_id = self._root_ids.get(wt_run_id)
            ls_id = str(uuid.uuid4())
            self._run_ids[event_id] = ls_id
            self._client.create_run(
                id=ls_id,
                name=f"{event.get('server', 'unknown')}.{event.get('tool', 'unknown')}",
                run_type="tool",
                project_name=self._project,
                parent_run_id=root_id,
                inputs=event.get("input") or {},
                tags=[f"risk:{event.get('risk', 'low')}", f"server:{event.get('server', 'unknown')}"],
                start_time=datetime.now(UTC),
            )

        elif event_type in {"tool_call_completed", "tool_call_failed", "tool_call_timeout"}:
            ls_id = self._run_ids.pop(parent_id or event_id, None)
            if ls_id is None:
                return
            success = event_type == "tool_call_completed"
            self._client.update_run(
                run_id=ls_id,
                outputs=event.get("output_summary") or {},
                error=str(event.get("error", "")) if not success else None,
                end_time=datetime.now(UTC),
            )

        elif event_type in {"run_completed", "run_failed"}:
            root_id = self._root_ids.pop(wt_run_id, None)
            if root_id:
                self._client.update_run(
                    run_id=root_id,
                    outputs={"status": event_type},
                    end_time=datetime.now(UTC),
                )
