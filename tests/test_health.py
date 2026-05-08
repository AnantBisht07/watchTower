from pathlib import Path
import asyncio

from mcp_watchtower.bus import EventBus
from mcp_watchtower.emitter import EventEmitter
from mcp_watchtower.health import HealthChecker, count_tools
from mcp_watchtower.storage import SQLiteStore
from mcp_watchtower.watchtower import Watchtower


class AsyncHealthyClient:
    async def list_tools(self) -> list[dict]:
        return [{"name": "read_file"}, {"name": "write_file"}]


class SyncHealthyClient:
    def list_tools(self) -> dict:
        return {"tools": [{"name": "search"}, {"name": "create_issue"}, {"name": "close_issue"}]}


class FailingClient:
    async def list_tools(self) -> None:
        raise RuntimeError("auth token expired")


class SlowClient:
    async def list_tools(self) -> list[dict]:
        await asyncio.sleep(1)
        return []


def test_count_tools_handles_common_shapes() -> None:
    assert count_tools(None) == 0
    assert count_tools([1, 2]) == 2
    assert count_tools({"tools": [1, 2, 3]}) == 3
    assert count_tools({"one": 1, "two": 2}) == 2


def test_health_checker_records_healthy_async_client(tmp_path: Path) -> None:
    async def run() -> None:
        store = SQLiteStore(tmp_path / "watchtower.db")
        created_run = store.create_run("test-agent")
        emitter = EventEmitter(created_run["run_id"], store, EventBus())
        checker = HealthChecker(store, emitter)

        health = await checker.check_client("filesystem", AsyncHealthyClient())

        assert health["status"] == "healthy"
        assert health["tools_count"] == 2
        stored = store.list_server_health()
        assert stored[0]["server"] == "filesystem"
        assert stored[0]["status"] == "healthy"

        event_types = [event["type"] for event in store.list_events(created_run["run_id"])]
        assert event_types == ["health_check_started", "health_check_completed"]

    asyncio.run(run())


def test_health_checker_records_healthy_sync_client(tmp_path: Path) -> None:
    async def run() -> None:
        store = SQLiteStore(tmp_path / "watchtower.db")
        checker = HealthChecker(store)

        health = await checker.check_client("github", SyncHealthyClient())

        assert health["status"] == "healthy"
        assert health["tools_count"] == 3

    asyncio.run(run())


def test_health_checker_records_auth_failure(tmp_path: Path) -> None:
    async def run() -> None:
        store = SQLiteStore(tmp_path / "watchtower.db")
        created_run = store.create_run("test-agent")
        emitter = EventEmitter(created_run["run_id"], store, EventBus())
        checker = HealthChecker(store, emitter)

        health = await checker.check_client("github", FailingClient())

        assert health["status"] == "auth_failed"
        assert health["last_error"] == "auth token expired"
        event_types = [event["type"] for event in store.list_events(created_run["run_id"])]
        assert event_types == ["health_check_started", "health_check_failed"]

    asyncio.run(run())


def test_health_checker_records_timeout(tmp_path: Path) -> None:
    async def run() -> None:
        store = SQLiteStore(tmp_path / "watchtower.db")
        checker = HealthChecker(store, timeout_s=0.01)

        health = await checker.check_client("browser", SlowClient())

        assert health["status"] == "timeout"
        assert "did not respond" in health["last_error"]

    asyncio.run(run())


def test_watchtower_exposes_mcp_server_health_check(tmp_path: Path) -> None:
    async def run() -> None:
        watchtower = Watchtower("health-test", db_path=tmp_path / "watchtower.db")

        health = await watchtower.check_mcp_server("filesystem", AsyncHealthyClient())

        assert health["status"] == "healthy"
        events = watchtower.store.list_events(watchtower.run_id)
        assert [event["type"] for event in events] == [
            "health_check_started",
            "health_check_completed",
        ]

    asyncio.run(run())


def test_watchtower_health_check_records_server_metadata(tmp_path: Path) -> None:
    async def run() -> None:
        watchtower = Watchtower("health-test", db_path=tmp_path / "watchtower.db")

        await watchtower.check_mcp_server(
            "gmail",
            AsyncHealthyClient(),
            transport="stdio",
            server_metadata={"package": "user-owned-gmail-mcp", "transport": "stdio"},
        )

        metadata = watchtower.store.get_latest_server_metadata("gmail")
        assert metadata == {"package": "user-owned-gmail-mcp", "transport": "stdio"}

    asyncio.run(run())
