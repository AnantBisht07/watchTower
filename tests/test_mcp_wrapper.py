from pathlib import Path
import asyncio

import pytest

from mcp_watchtower.bus import EventBus
from mcp_watchtower.emitter import EventEmitter
from mcp_watchtower.mcp_wrapper import ToolRejectedError, WatchtowerMCPClient
from mcp_watchtower.safety import SafetyPolicy
from mcp_watchtower.storage import SQLiteStore


class FakeMCPClient:
    async def call_tool(self, tool_name: str, arguments: dict) -> list[dict]:
        assert tool_name == "search_issues"
        assert arguments == {"query": "is:open"}
        return [{"id": 1}, {"id": 2}]


class FailingMCPClient:
    async def call_tool(self, tool_name: str, arguments: dict) -> None:
        raise RuntimeError("service unavailable")


class RecordingMCPClient:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict]] = []

    async def call_tool(self, tool_name: str, arguments: dict) -> dict:
        self.calls.append((tool_name, arguments))
        return {"ok": True}


class KeywordMCPClient:
    async def call_tool(self, *, name: str, arguments: dict) -> dict:
        return {"name": name, "arguments": arguments}


def test_wrapper_emits_successful_tool_lifecycle(tmp_path: Path) -> None:
    async def run() -> None:
        store = SQLiteStore(tmp_path / "watchtower.db")
        created_run = store.create_run("test-agent")
        emitter = EventEmitter(created_run["run_id"], store, EventBus())
        client = WatchtowerMCPClient(FakeMCPClient(), emitter, server_name="github")

        result = await client.call_tool("search_issues", {"query": "is:open"})

        assert result == [{"id": 1}, {"id": 2}]
        events = store.list_events(created_run["run_id"])
        assert [event["type"] for event in events] == [
            "tool_call_requested",
            "tool_call_started",
            "tool_call_completed",
        ]
        assert events[-1]["output_summary"] == {"type": "list", "count": 2}
        stats = store.list_tool_reliability()
        assert stats[0]["server"] == "github"
        assert stats[0]["tool"] == "search_issues"
        assert stats[0]["success_count"] == 1

    asyncio.run(run())


def test_wrapper_supports_keyword_style_mcp_client_and_metadata(tmp_path: Path) -> None:
    async def run() -> None:
        store = SQLiteStore(tmp_path / "watchtower.db")
        created_run = store.create_run("test-agent")
        emitter = EventEmitter(created_run["run_id"], store, EventBus())
        client = WatchtowerMCPClient(
            KeywordMCPClient(),
            emitter,
            server_name="gmail",
            server_metadata={"transport": "stdio", "package": "user-owned-gmail-mcp"},
        )

        result = await client.call_tool("search_emails", {"query": "is:unread"})

        assert result == {"name": "search_emails", "arguments": {"query": "is:unread"}}
        events = store.list_events(created_run["run_id"])
        assert events[0]["metadata"]["server_metadata"]["package"] == "user-owned-gmail-mcp"
        assert events[0]["metadata"]["safety_action"] == "allow"

    asyncio.run(run())


def test_wrapper_waits_for_approval_before_state_changing_tool(tmp_path: Path) -> None:
    async def run() -> None:
        store = SQLiteStore(tmp_path / "watchtower.db")
        created_run = store.create_run("test-agent")
        emitter = EventEmitter(created_run["run_id"], store, EventBus())
        raw_client = RecordingMCPClient()
        client = WatchtowerMCPClient(
            raw_client,
            emitter,
            server_name="filesystem",
            safety_policy=SafetyPolicy(),
            approval_timeout_s=2,
            approval_poll_interval_s=0.01,
        )

        task = asyncio.create_task(client.call_tool("write_file", {"path": "summary.md"}))
        approval = await wait_for_approval(store, created_run["run_id"])
        assert raw_client.calls == []

        decided, changed = store.decide_approval(approval["approval_id"], "approved")
        assert changed is True
        assert decided is not None

        result = await task
        assert result == {"ok": True}
        assert raw_client.calls == [("write_file", {"path": "summary.md"})]

        event_types = [event["type"] for event in store.list_events(created_run["run_id"])]
        assert event_types == [
            "tool_call_requested",
            "approval_required",
            "tool_call_approved",
            "tool_call_started",
            "tool_call_completed",
        ]

    asyncio.run(run())


def test_wrapper_rejects_state_changing_tool_without_calling_client(tmp_path: Path) -> None:
    async def run() -> None:
        store = SQLiteStore(tmp_path / "watchtower.db")
        created_run = store.create_run("test-agent")
        emitter = EventEmitter(created_run["run_id"], store, EventBus())
        raw_client = RecordingMCPClient()
        client = WatchtowerMCPClient(
            raw_client,
            emitter,
            server_name="filesystem",
            safety_policy=SafetyPolicy(),
            approval_timeout_s=2,
            approval_poll_interval_s=0.01,
        )

        task = asyncio.create_task(client.call_tool("write_file", {"path": "summary.md"}))
        approval = await wait_for_approval(store, created_run["run_id"])
        store.decide_approval(approval["approval_id"], "rejected")

        with pytest.raises(ToolRejectedError):
            await task

        assert raw_client.calls == []
        event_types = [event["type"] for event in store.list_events(created_run["run_id"])]
        assert event_types == [
            "tool_call_requested",
            "approval_required",
            "tool_call_rejected",
        ]

    asyncio.run(run())


def test_wrapper_blocks_high_risk_tool_without_approval(tmp_path: Path) -> None:
    async def run() -> None:
        store = SQLiteStore(tmp_path / "watchtower.db")
        created_run = store.create_run("test-agent")
        emitter = EventEmitter(created_run["run_id"], store, EventBus())
        raw_client = RecordingMCPClient()
        client = WatchtowerMCPClient(
            raw_client,
            emitter,
            server_name="filesystem",
            safety_policy=SafetyPolicy(),
        )

        with pytest.raises(ToolRejectedError):
            await client.call_tool("delete_file", {"path": "summary.md"})

        assert raw_client.calls == []
        event_types = [event["type"] for event in store.list_events(created_run["run_id"])]
        assert event_types == ["tool_call_requested", "tool_call_rejected"]

    asyncio.run(run())


def test_wrapper_emits_failed_tool_lifecycle(tmp_path: Path) -> None:
    async def run() -> None:
        store = SQLiteStore(tmp_path / "watchtower.db")
        created_run = store.create_run("test-agent")
        emitter = EventEmitter(created_run["run_id"], store, EventBus())
        client = WatchtowerMCPClient(FailingMCPClient(), emitter, server_name="github")

        with pytest.raises(RuntimeError):
            await client.call_tool("search_issues", {"query": "is:open"})

        events = store.list_events(created_run["run_id"])
        assert events[-1]["type"] == "tool_call_failed"
        assert events[-1]["error"]["code"] == "RuntimeError"
        stats = store.list_tool_reliability()
        assert stats[0]["failure_count"] == 1

    asyncio.run(run())


async def wait_for_approval(store: SQLiteStore, run_id: str) -> dict:
    for _ in range(100):
        approvals = store.list_approvals(run_id=run_id)
        if approvals:
            return approvals[0]
        await asyncio.sleep(0.01)
    raise AssertionError("approval was not created")
