from pathlib import Path
import asyncio

from mcp_watchtower.bus import EventBus
from mcp_watchtower.emitter import EventEmitter
from mcp_watchtower.storage import SQLiteStore


def test_emitter_persists_and_replays_events(tmp_path: Path) -> None:
    async def run() -> None:
        store = SQLiteStore(tmp_path / "watchtower.db")
        created_run = store.create_run("test-agent", task="inspect repo")
        emitter = EventEmitter(created_run["run_id"], store, EventBus())

        event = await emitter.emit(
            {
                "type": "tool_call_requested",
                "status": "pending",
                "message": "Agent requested github.search_issues",
                "server": "github",
                "tool": "search_issues",
                "input": {"query": "is:issue"},
            }
        )

        replayed = store.list_events(created_run["run_id"])
        assert len(replayed) == 1
        assert replayed[0]["event_id"] == event["event_id"]
        assert replayed[0]["input"] == {"query": "is:issue"}

    asyncio.run(run())


def test_run_completed_updates_run_status(tmp_path: Path) -> None:
    async def run() -> None:
        store = SQLiteStore(tmp_path / "watchtower.db")
        created_run = store.create_run("test-agent")
        emitter = EventEmitter(created_run["run_id"], store, EventBus())

        await emitter.emit(
            {
                "type": "run_completed",
                "status": "completed",
                "message": "Run completed",
            }
        )

        stored_run = store.get_run(created_run["run_id"])
        assert stored_run is not None
        assert stored_run["status"] == "completed"
        assert stored_run["completed_at"] is not None

    asyncio.run(run())


def test_server_health_round_trips_through_sqlite(tmp_path: Path) -> None:
    store = SQLiteStore(tmp_path / "watchtower.db")

    store.upsert_server_health(
        {
            "server": "github",
            "status": "healthy",
            "tools_count": 18,
            "latency_ms": 140,
            "last_checked_at": "2026-05-03T10:30:00Z",
            "last_error": None,
        }
    )

    health = store.list_server_health()
    assert health == [
        {
            "server": "github",
            "run_id": None,
            "status": "healthy",
            "tools_count": 18,
            "latency_ms": 140,
            "last_checked_at": "2026-05-03T10:30:00Z",
            "last_error": None,
        }
    ]


def test_approval_required_event_creates_waiting_approval(tmp_path: Path) -> None:
    async def run() -> None:
        store = SQLiteStore(tmp_path / "watchtower.db")
        created_run = store.create_run("test-agent")
        emitter = EventEmitter(created_run["run_id"], store, EventBus())

        event = await emitter.emit(
            {
                "type": "approval_required",
                "status": "waiting",
                "message": "Approval required before filesystem.write_file",
                "reason": "This tool modifies a local file.",
                "approval_id": "apv_test_write",
                "risk": "medium",
                "server": "filesystem",
                "tool": "write_file",
            }
        )

        approval = store.get_approval("apv_test_write")
        assert approval is not None
        assert approval["event_id"] == event["event_id"]
        assert approval["status"] == "waiting"
        assert approval["risk"] == "medium"
        assert approval["reason"] == "This tool modifies a local file."

    asyncio.run(run())


def test_approval_decision_is_persisted_once(tmp_path: Path) -> None:
    store = SQLiteStore(tmp_path / "watchtower.db")
    created_run = store.create_run("test-agent")
    store.create_approval(
        run_id=created_run["run_id"],
        approval_id="apv_test_write",
        risk="medium",
        reason="Needs review.",
    )

    approval, changed = store.decide_approval("apv_test_write", "approved")
    assert changed is True
    assert approval is not None
    assert approval["status"] == "approved"
    assert approval["decision"] == "approved"
    assert approval["decided_at"] is not None

    approval, changed = store.decide_approval("apv_test_write", "rejected")
    assert changed is False
    assert approval is not None
    assert approval["status"] == "approved"


def test_tool_reliability_stats_aggregate_lifecycle_events(tmp_path: Path) -> None:
    async def run() -> None:
        store = SQLiteStore(tmp_path / "watchtower.db")
        created_run = store.create_run("test-agent")
        emitter = EventEmitter(created_run["run_id"], store, EventBus())

        await emitter.emit(
            {
                "type": "tool_call_completed",
                "status": "completed",
                "message": "github.search_issues completed",
                "server": "github",
                "tool": "search_issues",
                "latency_ms": 100,
            }
        )
        await emitter.emit(
            {
                "type": "tool_call_failed",
                "status": "failed",
                "message": "github.search_issues failed",
                "server": "github",
                "tool": "search_issues",
                "latency_ms": 200,
                "error": {"code": "RuntimeError", "detail": "boom"},
            }
        )
        await emitter.emit(
            {
                "type": "tool_call_timeout",
                "status": "failed",
                "message": "github.search_issues timed out",
                "server": "github",
                "tool": "search_issues",
                "latency_ms": 300,
                "error": {"code": "TIMEOUT", "detail": "slow"},
            }
        )

        stats = store.list_tool_reliability()
        assert len(stats) == 1
        assert stats[0]["server"] == "github"
        assert stats[0]["tool"] == "search_issues"
        assert stats[0]["success_count"] == 1
        assert stats[0]["failure_count"] == 1
        assert stats[0]["timeout_count"] == 1
        assert stats[0]["avg_latency_ms"] == 200
        assert "TIMEOUT" in stats[0]["last_error"]

    asyncio.run(run())
