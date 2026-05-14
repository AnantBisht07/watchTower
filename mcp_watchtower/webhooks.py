"""Webhook notifications for Watchtower events.

Usage:
    from mcp_watchtower import Watchtower

    watchtower = Watchtower(
        app_name="my-agent",
        webhooks={
            "approval_required": "https://hooks.slack.com/services/...",
            "tool_call_rejected": "https://hooks.slack.com/services/...",
            "run_failed": "https://my-server.com/webhook",
        },
    )
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any


class WebhookDispatcher:
    def __init__(self, hooks: dict[str, str]) -> None:
        # event_type -> URL
        self._hooks = hooks

    def dispatch(self, event: dict[str, Any]) -> None:
        event_type = event.get("type", "")
        url = self._hooks.get(event_type)
        if url is None:
            return
        payload = _format_payload(event, url)
        _post(url, payload)


def _format_payload(event: dict[str, Any], url: str) -> dict[str, Any]:
    """Format event as a Slack-compatible or generic JSON payload."""
    event_type = event.get("type", "")
    message = event.get("message", event_type)
    server = event.get("server")
    tool = event.get("tool")
    risk = event.get("risk", "")
    run_id = event.get("run_id", "")

    tool_label = f"{server}.{tool}" if server and tool else tool or ""

    # Slack incoming webhook format (works for most Slack hooks)
    if "hooks.slack.com" in url:
        text = f"*MCP Watchtower* — `{event_type}`\n{message}"
        if tool_label:
            text += f"\nTool: `{tool_label}`"
        if risk:
            text += f"  Risk: `{risk}`"
        if run_id:
            text += f"\nRun: `{run_id}`"
        return {"text": text}

    # Generic payload
    return {
        "event_type": event_type,
        "message": message,
        "tool": tool_label,
        "risk": risk,
        "run_id": run_id,
        "timestamp": event.get("timestamp", ""),
    }


def _post(url: str, payload: dict[str, Any]) -> None:
    body = json.dumps(payload).encode()
    req = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=5):
            pass
    except (urllib.error.URLError, OSError):
        # Fire-and-forget: log silently, never block the agent
        pass
