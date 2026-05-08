"""Gmail MCP use-case smoke for Watchtower UI/API rendering.

This uses sanitized Gmail-shaped data and the real Watchtower storage/server
boundary. It validates how a Gmail MCP server run appears to a user without
reading or modifying a real mailbox.
"""

from __future__ import annotations

import asyncio
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any
from urllib.error import URLError
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from mcp_watchtower.bus import EventBus
from mcp_watchtower.emitter import EventEmitter
from mcp_watchtower.storage import SQLiteStore


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="watchtower-gmail-") as tmp:
        tmp_path = Path(tmp)
        seed_gmail_run(tmp_path / ".watchtower" / "watchtower.db")
        port = free_port()
        base_url = f"http://127.0.0.1:{port}"
        process = start_server(tmp_path, port)
        try:
            wait_for_server(base_url, process)
            assert_ui_shell(base_url)
            assert_gmail_run_api(base_url)
            assert_gmail_sse_replay(base_url)
        finally:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=10)

    print("Gmail use-case smoke passed")


def seed_gmail_run(db_path: Path) -> None:
    async def seed() -> None:
        store = SQLiteStore(db_path)
        run = store.create_run(
            "gmail-triage-agent",
            task="Triage unread Gmail, draft a reply, and require approval before sending",
        )
        emitter = EventEmitter(run["run_id"], store, EventBus())

        store.upsert_server_health(
            {
                "server": "gmail",
                "run_id": run["run_id"],
                "status": "healthy",
                "tools_count": 5,
                "latency_ms": 118,
                "last_checked_at": "2026-05-04T09:00:00Z",
                "last_error": None,
            }
        )
        await emitter.emit(
            {
                "type": "run_started",
                "status": "running",
                "message": "Gmail triage agent started",
            }
        )
        await emitter.emit(
            {
                "type": "health_check_completed",
                "status": "completed",
                "server": "gmail",
                "latency_ms": 118,
                "message": "gmail MCP service is healthy",
                "metadata": {"tools_count": 5, "transport": "stdio"},
            }
        )
        await emitter.emit(
            {
                "type": "tools_discovered",
                "status": "completed",
                "server": "gmail",
                "message": "Discovered 5 tools from gmail",
                "metadata": {
                    "tools": [
                        "search_emails",
                        "read_email",
                        "create_draft",
                        "send_email",
                        "apply_labels",
                    ]
                },
            }
        )
        search_request = await emitter.emit(
            {
                "type": "tool_call_requested",
                "status": "pending",
                "server": "gmail",
                "tool": "search_emails",
                "risk": "low",
                "message": "Agent requested gmail.search_emails",
                "input": {"query": "in:inbox is:unread newer_than:7d", "max_results": 5},
            }
        )
        await emitter.emit(
            {
                "type": "tool_call_completed",
                "status": "completed",
                "parent_event_id": search_request["event_id"],
                "server": "gmail",
                "tool": "search_emails",
                "latency_ms": 340,
                "message": "gmail.search_emails completed",
                "output_summary": {"type": "list", "count": 3},
            }
        )
        read_request = await emitter.emit(
            {
                "type": "tool_call_requested",
                "status": "pending",
                "server": "gmail",
                "tool": "read_email",
                "risk": "low",
                "message": "Agent requested gmail.read_email",
                "input": {"message_id": "msg_sanitized_001"},
            }
        )
        await emitter.emit(
            {
                "type": "tool_call_completed",
                "status": "completed",
                "parent_event_id": read_request["event_id"],
                "server": "gmail",
                "tool": "read_email",
                "latency_ms": 221,
                "message": "gmail.read_email completed",
                "output_summary": {"type": "object", "keys": ["from", "subject", "snippet"]},
            }
        )
        draft_request = await emitter.emit(
            {
                "type": "tool_call_requested",
                "status": "pending",
                "server": "gmail",
                "tool": "create_draft",
                "risk": "medium",
                "message": "Agent requested gmail.create_draft",
                "input": {
                    "to": "customer@example.com",
                    "subject": "Re: Product onboarding",
                    "body_preview": "Thanks for reaching out...",
                },
            }
        )
        await emitter.emit(
            {
                "type": "tool_call_completed",
                "status": "completed",
                "parent_event_id": draft_request["event_id"],
                "server": "gmail",
                "tool": "create_draft",
                "latency_ms": 410,
                "message": "gmail.create_draft completed",
                "output_summary": {"type": "object", "keys": ["draft_id", "thread_id"]},
            }
        )
        await emitter.emit(
            {
                "type": "approval_required",
                "status": "waiting",
                "server": "gmail",
                "tool": "send_email",
                "risk": "high",
                "approval_id": "apv_gmail_send_sanitized",
                "message": "Approval required before gmail.send_email",
                "reason": "Sending email transmits data outside the local machine.",
                "input": {
                    "draft_id": "draft_sanitized_001",
                    "to": "customer@example.com",
                    "subject": "Re: Product onboarding",
                },
            }
        )
        await emitter.emit(
            {
                "type": "run_completed",
                "status": "completed",
                "message": "Gmail triage run paused with one pending send approval",
            }
        )
        store.close()

    asyncio.run(seed())


def start_server(cwd: Path, port: int) -> subprocess.Popen[str]:
    env = os.environ.copy()
    env["PYTHONPATH"] = str(ROOT)
    return subprocess.Popen(
        [
            sys.executable,
            "-m",
            "uvicorn",
            "mcp_watchtower.server:app",
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
        ],
        cwd=cwd,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )


def assert_ui_shell(base_url: str) -> None:
    html = get_text(f"{base_url}/")
    assert "MCP Watchtower" in html
    assert "/assets/" in html


def assert_gmail_run_api(base_url: str) -> None:
    runs = get_json(f"{base_url}/api/runs")
    assert runs[0]["app_name"] == "gmail-triage-agent"
    payload = get_json(f"{base_url}/api/runs/{runs[0]['run_id']}/events")
    events = payload["events"]
    rendered_messages = "\n".join(event["message"] for event in events)
    assert "gmail.search_emails completed" in rendered_messages
    assert "gmail.read_email completed" in rendered_messages
    assert "gmail.create_draft completed" in rendered_messages
    assert "Approval required before gmail.send_email" in rendered_messages

    health = get_json(f"{base_url}/api/servers/health")
    reliability = get_json(f"{base_url}/api/tools/reliability")
    approvals = get_json(f"{base_url}/api/approvals?run_id={runs[0]['run_id']}")
    assert health[0]["server"] == "gmail"
    assert {item["tool"] for item in reliability} >= {
        "search_emails",
        "read_email",
        "create_draft",
    }
    assert approvals[0]["approval_id"] == "apv_gmail_send_sanitized"
    assert approvals[0]["status"] == "waiting"


def assert_gmail_sse_replay(base_url: str) -> None:
    run = get_json(f"{base_url}/api/runs")[0]
    request = Request(f"{base_url}/api/runs/{run['run_id']}/events/stream")
    with urlopen(request, timeout=5) as response:
        seen: list[str] = []
        while len(seen) < 8:
            line = response.readline().decode("utf-8")
            if line.startswith("data:"):
                event = json.loads(line.removeprefix("data:").strip())
                seen.append(event["type"])
                if event["type"] == "health_check_completed":
                    assert event["server"] == "gmail"
                    return
    raise AssertionError("Gmail SSE replay did not include health event")


def wait_for_server(base_url: str, process: subprocess.Popen[str]) -> None:
    deadline = time.time() + 20
    while time.time() < deadline:
        if process.poll() is not None:
            output = process.stdout.read() if process.stdout else ""
            raise RuntimeError(f"server exited early with {process.returncode}\n{output}")
        try:
            get_json(f"{base_url}/api/runs")
            return
        except (URLError, TimeoutError, ConnectionError):
            time.sleep(0.2)
    raise TimeoutError("server did not become ready")


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def get_json(url: str) -> Any:
    return json.loads(get_text(url))


def get_text(url: str) -> str:
    with urlopen(url, timeout=5) as response:
        return response.read().decode("utf-8")


if __name__ == "__main__":
    main()
