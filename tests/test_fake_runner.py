from pathlib import Path
import asyncio

from mcp_watchtower.bus import EventBus
from mcp_watchtower.emitter import EventEmitter
from mcp_watchtower.fake_runner import run_fake_journey
from mcp_watchtower.fake_runner import run_safety_gate_demo
from mcp_watchtower.storage import SQLiteStore


def test_fake_runner_produces_complete_journey(tmp_path: Path) -> None:
    async def run() -> None:
        store = SQLiteStore(tmp_path / "watchtower.db")
        created_run = store.create_run("fake-agent-demo")
        emitter = EventEmitter(created_run["run_id"], store, EventBus())

        await run_fake_journey(emitter, store, delay=0)

        events = store.list_events(created_run["run_id"])
        event_types = [event["type"] for event in events]
        assert event_types[0] == "run_started"
        assert "tool_call_requested" in event_types
        assert "approval_required" in event_types
        assert event_types[-1] == "run_completed"

        health = store.list_server_health()
        assert {item["server"] for item in health} == {"browser", "filesystem", "github"}

    asyncio.run(run())


def test_safety_gate_demo_waits_for_approval_then_completes(tmp_path: Path) -> None:
    async def run() -> None:
        store = SQLiteStore(tmp_path / "watchtower.db")
        created_run = store.create_run("safety-gate-demo")
        emitter = EventEmitter(created_run["run_id"], store, EventBus())

        task = asyncio.create_task(
            run_safety_gate_demo(emitter, store, delay=0, approval_timeout_s=2)
        )

        approval = await wait_for_approval(store, created_run["run_id"])
        event_types_before_approval = [event["type"] for event in store.list_events(created_run["run_id"])]
        assert "approval_required" in event_types_before_approval
        assert "tool_call_started" not in event_types_before_approval

        store.decide_approval(approval["approval_id"], "approved")
        await task

        event_types = [event["type"] for event in store.list_events(created_run["run_id"])]
        assert "tool_call_approved" in event_types
        assert "tool_call_started" in event_types
        assert event_types[-1] == "run_completed"

    asyncio.run(run())


def test_safety_gate_demo_rejection_stops_before_tool_execution(tmp_path: Path) -> None:
    async def run() -> None:
        store = SQLiteStore(tmp_path / "watchtower.db")
        created_run = store.create_run("safety-gate-demo")
        emitter = EventEmitter(created_run["run_id"], store, EventBus())

        task = asyncio.create_task(
            run_safety_gate_demo(emitter, store, delay=0, approval_timeout_s=2)
        )

        approval = await wait_for_approval(store, created_run["run_id"])
        store.decide_approval(approval["approval_id"], "rejected")
        await task

        event_types = [event["type"] for event in store.list_events(created_run["run_id"])]
        assert "tool_call_rejected" in event_types
        assert "tool_call_started" not in event_types
        assert event_types[-1] == "run_failed"

    asyncio.run(run())


async def wait_for_approval(store: SQLiteStore, run_id: str) -> dict:
    for _ in range(100):
        approvals = store.list_approvals(run_id=run_id)
        if approvals:
            return approvals[0]
        await asyncio.sleep(0.01)
    raise AssertionError("approval was not created")
