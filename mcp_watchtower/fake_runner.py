"""Fake run generator used to prove the live journey experience."""

from __future__ import annotations

import asyncio

from .emitter import EventEmitter
from .health import HealthChecker, fake_health
from .mcp_wrapper import ApprovalTimeoutError, ToolRejectedError, WatchtowerMCPClient
from .safety import SafetyPolicy
from .storage import SQLiteStore


async def run_fake_journey(emitter: EventEmitter, store: SQLiteStore, delay: float = 0.65) -> None:
    run_id = emitter.run_id
    await emitter.emit(
        {
            "type": "run_started",
            "status": "running",
            "message": "Agent run started",
            "metadata": {"source": "fake_runner"},
        }
    )
    await asyncio.sleep(delay)

    for health in fake_health(run_id):
        store.upsert_server_health(health)
        await emitter.emit(
            {
                "type": "health_check_completed"
                if health["status"] == "healthy"
                else "health_check_failed",
                "status": "completed" if health["status"] == "healthy" else "failed",
                "server": health["server"],
                "latency_ms": health["latency_ms"],
                "message": f"{health['server']} service is {health['status']}",
                "metadata": health,
            }
        )
        await asyncio.sleep(delay)

    await emitter.emit(
        {
            "type": "tools_discovered",
            "status": "completed",
            "server": "github",
            "message": "Discovered 18 tools from github",
            "metadata": {"tools_count": 18},
        }
    )
    await asyncio.sleep(delay)

    requested = await emitter.emit(
        {
            "type": "tool_call_requested",
            "status": "pending",
            "server": "github",
            "tool": "search_issues",
            "risk": "low",
            "message": "Agent wants to call github.search_issues",
            "input": {"repo": "lastmile-ai/mcp-agent", "query": "is:issue is:open"},
        }
    )
    await asyncio.sleep(delay)

    await emitter.emit(
        {
            "type": "tool_call_completed",
            "status": "completed",
            "parent_event_id": requested["event_id"],
            "server": "github",
            "tool": "search_issues",
            "latency_ms": 1432,
            "message": "github.search_issues completed",
            "output_summary": {"type": "list", "count": 34},
        }
    )
    await asyncio.sleep(delay)

    approval_id = "apv_fake_write_file"
    await emitter.emit(
        {
            "type": "approval_required",
            "status": "waiting",
            "server": "filesystem",
            "tool": "write_file",
            "risk": "medium",
            "approval_id": approval_id,
            "message": "Approval required before filesystem.write_file",
            "reason": "This tool modifies a local file.",
            "input": {"path": "summary.md", "content_preview": "# Repo Analysis..."},
        }
    )
    # Auto-approve after a short pause so the Journey Demo completes cleanly.
    await asyncio.sleep(delay * 3)
    store.decide_approval(approval_id, "approved")
    await emitter.emit(
        {
            "type": "tool_call_approved",
            "status": "completed",
            "server": "filesystem",
            "tool": "write_file",
            "approval_id": approval_id,
            "message": "filesystem.write_file auto-approved in Journey Demo",
            "metadata": {"decision": "approved"},
        }
    )
    await asyncio.sleep(delay)

    await emitter.emit(
        {
            "type": "tool_call_completed",
            "status": "completed",
            "server": "filesystem",
            "tool": "write_file",
            "latency_ms": 120,
            "message": "filesystem.write_file completed",
            "output_summary": {"type": "object", "keys": ["written"]},
        }
    )
    await asyncio.sleep(delay)

    await emitter.emit(
        {
            "type": "run_completed",
            "status": "completed",
            "message": "Fake agent run completed",
        }
    )


class SafetyDemoFilesystemClient:
    async def list_tools(self) -> list[dict[str, str]]:
        return [
            {"name": "read_file"},
            {"name": "write_file"},
            {"name": "delete_file"},
        ]

    async def call_tool(self, tool_name: str, arguments: dict) -> dict:
        await asyncio.sleep(0.4)
        return {
            "tool": tool_name,
            "path": arguments.get("path"),
            "written": True,
        }


async def run_safety_gate_demo(
    emitter: EventEmitter,
    store: SQLiteStore,
    delay: float = 0.45,
    approval_timeout_s: float = 180,
) -> None:
    client = SafetyDemoFilesystemClient()
    wrapped_client = WatchtowerMCPClient(
        client,
        emitter,
        server_name="filesystem",
        safety_policy=SafetyPolicy(),
        approval_timeout_s=approval_timeout_s,
    )

    await emitter.emit(
        {
            "type": "run_started",
            "status": "running",
            "message": "Safety-gated MCP run started",
            "metadata": {"source": "safety_gate_demo"},
        }
    )
    await asyncio.sleep(delay)

    checker = HealthChecker(store, emitter)
    await checker.check_client("filesystem", client, transport="demo")
    await asyncio.sleep(delay)

    await emitter.emit(
        {
            "type": "agent_step_started",
            "status": "running",
            "message": "Agent is preparing a filesystem write",
        }
    )
    await asyncio.sleep(delay)

    try:
        result = await wrapped_client.call_tool(
            "write_file",
            {
                "path": "summary.md",
                "content_preview": "# Repo Analysis\n\nThis content is waiting for approval.",
            },
        )
    except ToolRejectedError:
        await emitter.emit(
            {
                "type": "run_failed",
                "status": "failed",
                "message": "Safety demo stopped because the tool call was rejected",
            }
        )
        return
    except ApprovalTimeoutError:
        await emitter.emit(
            {
                "type": "run_failed",
                "status": "failed",
                "message": "Safety demo stopped because approval timed out",
            }
        )
        return

    await emitter.emit(
        {
            "type": "agent_step_completed",
            "status": "completed",
            "message": "Agent received the approved tool result",
            "output_summary": result,
        }
    )
    await asyncio.sleep(delay)

    await emitter.emit(
        {
            "type": "run_completed",
            "status": "completed",
            "message": "Safety-gated MCP run completed",
        }
    )
