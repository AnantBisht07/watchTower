"""End-to-end smoke test for the local Watchtower server.

The script starts the real FastAPI/Uvicorn server against a temporary working
directory, drives the public HTTP API, verifies SSE replay, exercises approval
approve/reject flows, and shuts the server down.
"""

from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path
from typing import Any
from urllib.error import URLError
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    port = free_port()
    base_url = f"http://127.0.0.1:{port}"
    env = os.environ.copy()
    env["PYTHONPATH"] = str(ROOT)

    with tempfile.TemporaryDirectory(prefix="watchtower-smoke-") as tmp:
        server_output: list[str] = []
        process = subprocess.Popen(
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
            cwd=tmp,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        output_thread = threading.Thread(
            target=collect_output,
            args=(process, server_output),
            daemon=True,
        )
        output_thread.start()
        try:
            wait_for_server(base_url, process)
            assert_ui_served(base_url)
            assert_journey_demo(base_url)
            assert_safety_approval_flow(base_url, decision="approve")
            assert_safety_approval_flow(base_url, decision="reject")
            assert_stats_endpoints(base_url)
        except BaseException:
            print("Server output:")
            print("".join(server_output[-200:]))
            raise
        finally:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=10)
            output_thread.join(timeout=2)

    print("E2E smoke passed")


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def wait_for_server(base_url: str, process: subprocess.Popen[str]) -> None:
    deadline = time.time() + 20
    while time.time() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"server exited early with {process.returncode}")
        try:
            get_json(f"{base_url}/api/runs")
            return
        except (URLError, TimeoutError, ConnectionError):
            time.sleep(0.2)
    raise TimeoutError("server did not become ready")


def assert_ui_served(base_url: str) -> None:
    body = get_text(f"{base_url}/")
    assert "MCP Watchtower" in body
    assert "/assets/" in body


def assert_journey_demo(base_url: str) -> None:
    run = post_json(f"{base_url}/api/runs/demo")
    assert run["app_name"] == "fake-agent-demo"
    events = wait_for_event(base_url, run["run_id"], "run_completed")
    event_types = [event["type"] for event in events]
    assert "health_check_completed" in event_types
    assert "tool_call_completed" in event_types
    assert_sse_replay(base_url, run["run_id"])


def assert_safety_approval_flow(base_url: str, decision: str) -> None:
    run = post_json(f"{base_url}/api/runs/safety-demo")
    approval = wait_for_approval(base_url, run["run_id"])
    decided = post_json(f"{base_url}/api/approvals/{approval['approval_id']}/{decision}")
    expected_status = "approved" if decision == "approve" else "rejected"
    assert decided["status"] == expected_status

    terminal_event = "run_completed" if decision == "approve" else "run_failed"
    events = wait_for_event(base_url, run["run_id"], terminal_event)
    event_types = [event["type"] for event in events]
    if decision == "approve":
        assert "tool_call_approved" in event_types
        assert "tool_call_started" in event_types
    else:
        assert "tool_call_rejected" in event_types
        assert "tool_call_started" not in event_types


def assert_stats_endpoints(base_url: str) -> None:
    health = get_json(f"{base_url}/api/servers/health")
    reliability = get_json(f"{base_url}/api/tools/reliability")
    runs = get_json(f"{base_url}/api/runs")
    assert len(runs) >= 3
    assert any(item["server"] == "filesystem" for item in health)
    assert any(item["tool"] == "write_file" for item in reliability)


def assert_sse_replay(base_url: str, run_id: str) -> None:
    request = Request(f"{base_url}/api/runs/{run_id}/events/stream")
    with urlopen(request, timeout=5) as response:
        lines: list[str] = []
        while len(lines) < 20:
            line = response.readline().decode("utf-8")
            if not line:
                break
            lines.append(line.strip())
            if line.startswith("data:"):
                payload = json.loads(line.removeprefix("data:").strip())
                assert payload["run_id"] == run_id
                assert payload["type"] == "run_started"
                return
    raise AssertionError("SSE replay did not return the first run event")


def wait_for_approval(base_url: str, run_id: str) -> dict[str, Any]:
    deadline = time.time() + 10
    while time.time() < deadline:
        try:
            approvals = get_json(f"{base_url}/api/approvals?run_id={run_id}")
        except (URLError, TimeoutError, ConnectionError):
            time.sleep(0.2)
            continue
        if approvals:
            return approvals[0]
        time.sleep(0.2)
    raise TimeoutError("approval was not created")


def wait_for_event(base_url: str, run_id: str, event_type: str) -> list[dict[str, Any]]:
    deadline = time.time() + 15
    while time.time() < deadline:
        try:
            payload = get_json(f"{base_url}/api/runs/{run_id}/events")
        except (URLError, TimeoutError, ConnectionError):
            time.sleep(0.2)
            continue
        events = payload["events"]
        if any(event["type"] == event_type for event in events):
            return events
        time.sleep(0.2)
    raise TimeoutError(f"event was not emitted: {event_type}")


def get_json(url: str) -> Any:
    return json.loads(get_text(url))


def post_json(url: str) -> Any:
    request = Request(url, method="POST")
    with urlopen(request, timeout=10) as response:
        return json.loads(response.read().decode("utf-8"))


def get_text(url: str) -> str:
    with urlopen(url, timeout=3) as response:
        return response.read().decode("utf-8")


def collect_output(process: subprocess.Popen[str], output: list[str]) -> None:
    if process.stdout is None:
        return
    for line in process.stdout:
        output.append(line)


if __name__ == "__main__":
    main()
