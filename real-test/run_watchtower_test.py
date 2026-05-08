"""Run Watchtower against a real subprocess-backed MCP-style server."""

from __future__ import annotations

import asyncio
import json
import os
import socket
import subprocess
import sys
import time
from pathlib import Path
from typing import Any
from urllib.error import URLError
from urllib.request import urlopen


ROOT = Path(__file__).resolve().parents[1]
REAL_TEST = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from mcp_watchtower import Watchtower


class StdioMCPClient:
    def __init__(self, command: list[str], cwd: Path) -> None:
        self._next_id = 0
        self._process = subprocess.Popen(
            command,
            cwd=cwd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )

    async def list_tools(self) -> dict[str, Any]:
        return await self._request("list_tools", {})

    async def call_tool(self, tool_name: str, arguments: dict[str, Any]) -> Any:
        return await self._request(
            "call_tool",
            {
                "name": tool_name,
                "arguments": arguments,
            },
        )

    async def close(self) -> None:
        self._process.terminate()
        try:
            await asyncio.to_thread(self._process.wait, 5)
        except subprocess.TimeoutExpired:
            self._process.kill()
            await asyncio.to_thread(self._process.wait, 5)

    async def _request(self, method: str, params: dict[str, Any]) -> Any:
        if self._process.poll() is not None:
            stderr = self._process.stderr.read() if self._process.stderr else ""
            raise RuntimeError(f"MCP server exited with {self._process.returncode}: {stderr}")

        self._next_id += 1
        request = {"id": self._next_id, "method": method, "params": params}
        assert self._process.stdin is not None
        assert self._process.stdout is not None
        self._process.stdin.write(json.dumps(request) + "\n")
        self._process.stdin.flush()
        line = await asyncio.to_thread(self._process.stdout.readline)
        if not line:
            raise RuntimeError("MCP server closed stdout")
        response = json.loads(line)
        if response.get("error"):
            error = response["error"]
            raise RuntimeError(f"{error['code']}: {error['message']}")
        return response["result"]


async def main() -> None:
    db_path = REAL_TEST / ".watchtower" / "watchtower.db"
    db_path.parent.mkdir(parents=True, exist_ok=True)
    if db_path.exists():
        db_path.unlink()

    raw_client = StdioMCPClient([sys.executable, "toy_mcp_server.py"], REAL_TEST)
    watchtower = Watchtower(
        "toy-mcp-real-test",
        db_path=db_path,
        safety=True,
        task="Observed a user-owned subprocess MCP server and approved one tool call",
    )
    try:
        server_metadata = {
            "transport": "stdio",
            "command": "python toy_mcp_server.py",
            "source": "user-owned MCP server",
        }
        client = watchtower.wrap_mcp_client(
            raw_client,
            server_name="toy_mcp",
            server_metadata=server_metadata,
        )

        health = await watchtower.check_mcp_server(
            "toy_mcp",
            raw_client,
            transport="stdio",
            server_metadata=server_metadata,
        )
        assert health["status"] == "healthy"
        assert health["tools_count"] == 2

        status = await client.call_tool("get_status", {})
        assert status["status"] == "ready"

        create_task = asyncio.create_task(
            client.call_tool(
                "create_note",
                {"title": "Watchtower real test", "body": "Created through a subprocess MCP server."},
            )
        )
        approval = await wait_for_approval(watchtower)
        assert approval["status"] == "waiting"
        watchtower.store.decide_approval(approval["approval_id"], "approved")
        note = await create_task
        assert note["id"] == "note_1"

        await watchtower.emit(
            {
                "type": "run_completed",
                "status": "completed",
                "message": "Toy MCP real test completed",
            }
        )

        events = watchtower.store.list_events(watchtower.run_id)
        event_types = [event["type"] for event in events]
        assert event_types.count("tool_call_completed") == 2
        assert "approval_required" in event_types
        assert "tool_call_approved" in event_types
        assert event_types[-1] == "run_completed"
    finally:
        watchtower.store.close()
        await raw_client.close()

    await assert_watchtower_ui_api(db_path)
    print("Real MCP subprocess test passed")
    print(f"Database: {db_path}")


async def wait_for_approval(watchtower: Watchtower) -> dict[str, Any]:
    for _ in range(100):
        approvals = watchtower.store.list_approvals(run_id=watchtower.run_id)
        if approvals:
            return approvals[0]
        await asyncio.sleep(0.05)
    raise TimeoutError("approval was not created")


async def assert_watchtower_ui_api(db_path: Path) -> None:
    del db_path
    port = free_port()
    base_url = f"http://127.0.0.1:{port}"
    env = os.environ.copy()
    env["PYTHONPATH"] = str(ROOT)
    server = subprocess.Popen(
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
        cwd=REAL_TEST,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    try:
        wait_for_server(base_url, server)
        html = get_text(f"{base_url}/")
        assert "MCP Watchtower" in html

        runs = get_json(f"{base_url}/api/runs")
        assert runs[0]["app_name"] == "toy-mcp-real-test"
        run_id = runs[0]["run_id"]
        payload = get_json(f"{base_url}/api/runs/{run_id}/events")
        messages = "\n".join(event["message"] for event in payload["events"])
        assert "toy_mcp.get_status completed" in messages
        assert "Approval required before toy_mcp.create_note" in messages
        assert "toy_mcp.create_note completed" in messages

        health = get_json(f"{base_url}/api/servers/health")
        reliability = get_json(f"{base_url}/api/tools/reliability")
        assert health[0]["server"] == "toy_mcp"
        assert health[0]["metadata"]["source"] == "user-owned MCP server"
        assert {item["tool"] for item in reliability} == {"create_note", "get_status"}
    finally:
        server.terminate()
        try:
            server.wait(timeout=10)
        except subprocess.TimeoutExpired:
            server.kill()
            server.wait(timeout=10)


def wait_for_server(base_url: str, process: subprocess.Popen[str]) -> None:
    deadline = time.time() + 20
    while time.time() < deadline:
        if process.poll() is not None:
            output = process.stdout.read() if process.stdout else ""
            raise RuntimeError(f"Watchtower server exited early:\n{output}")
        try:
            get_json(f"{base_url}/api/runs")
            return
        except (URLError, TimeoutError, ConnectionError):
            time.sleep(0.2)
    raise TimeoutError("Watchtower server did not become ready")


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
    asyncio.run(main())
