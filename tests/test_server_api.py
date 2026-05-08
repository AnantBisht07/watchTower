from pathlib import Path

from mcp_watchtower.events import new_id
from mcp_watchtower.server import WatchtowerRuntime, create_app


def test_run_events_endpoint_returns_run_and_events(tmp_path: Path) -> None:
    from fastapi.testclient import TestClient

    runtime = WatchtowerRuntime(tmp_path / "watchtower.db")
    app = create_app(runtime)
    client = TestClient(app)
    run = runtime.create_run(app_name="api-test")
    event_id = new_id("evt")
    runtime.store.append_event(
        {
            "event_id": event_id,
            "run_id": run["run_id"],
            "parent_event_id": None,
            "type": "run_started",
            "timestamp": "2026-05-03T10:30:00Z",
            "status": "running",
            "message": "Run started",
            "metadata": {},
        }
    )

    response = client.get(f"/api/runs/{run['run_id']}/events")

    assert response.status_code == 200
    payload = response.json()
    assert payload["run"]["run_id"] == run["run_id"]
    assert payload["events"][0]["event_id"] == event_id


def test_missing_run_endpoints_return_404(tmp_path: Path) -> None:
    from fastapi.testclient import TestClient

    runtime = WatchtowerRuntime(tmp_path / "watchtower.db")
    app = create_app(runtime)
    client = TestClient(app)

    run_response = client.get("/api/runs/run_missing")
    events_response = client.get("/api/runs/run_missing/events")
    stream_response = client.get("/api/runs/run_missing/events/stream")

    assert run_response.status_code == 404
    assert events_response.status_code == 404
    assert stream_response.status_code == 404


def test_tool_reliability_endpoint_returns_stats(tmp_path: Path) -> None:
    from fastapi.testclient import TestClient

    runtime = WatchtowerRuntime(tmp_path / "watchtower.db")
    app = create_app(runtime)
    client = TestClient(app)
    run = runtime.create_run(app_name="api-tool-stats-test")
    emitter = runtime.emitter_for(run["run_id"])

    import asyncio

    asyncio.run(
        emitter.emit(
            {
                "type": "tool_call_completed",
                "status": "completed",
                "message": "filesystem.read_file completed",
                "server": "filesystem",
                "tool": "read_file",
                "latency_ms": 25,
            }
        )
    )

    response = client.get("/api/tools/reliability")

    assert response.status_code == 200
    payload = response.json()
    assert any(
        item["server"] == "filesystem"
        and item["tool"] == "read_file"
        and item["success_count"] >= 1
        for item in payload
    )


def test_approval_endpoint_persists_decision_and_emits_event(tmp_path: Path) -> None:
    from fastapi.testclient import TestClient

    runtime = WatchtowerRuntime(tmp_path / "watchtower.db")
    app = create_app(runtime)
    client = TestClient(app)
    run = runtime.create_run(app_name="api-approval-test")
    emitter = runtime.emitter_for(run["run_id"])

    import asyncio

    asyncio.run(
        emitter.emit(
            {
                "type": "approval_required",
                "status": "waiting",
                "message": "Approval required before filesystem.write_file",
                "server": "filesystem",
                "tool": "write_file",
                "approval_id": "apv_api_write",
                "risk": "medium",
                "reason": "Writes need approval.",
            }
        )
    )

    response = client.post("/api/approvals/apv_api_write/approve")

    assert response.status_code == 200
    approval = response.json()
    assert approval["status"] == "approved"
    assert approval["decision"] == "approved"
    event_types = [event["type"] for event in runtime.store.list_events(run["run_id"])]
    assert event_types == ["approval_required", "tool_call_approved"]


def test_missing_approval_decision_returns_404(tmp_path: Path) -> None:
    from fastapi.testclient import TestClient

    runtime = WatchtowerRuntime(tmp_path / "watchtower.db")
    app = create_app(runtime)
    client = TestClient(app)

    response = client.post("/api/approvals/apv_missing/reject")

    assert response.status_code == 404


def test_server_health_endpoint_includes_latest_server_metadata(tmp_path: Path) -> None:
    from fastapi.testclient import TestClient

    runtime = WatchtowerRuntime(tmp_path / "watchtower.db")
    app = create_app(runtime)
    client = TestClient(app)
    run = runtime.create_run(app_name="api-health-metadata-test")
    emitter = runtime.emitter_for(run["run_id"])
    runtime.store.upsert_server_health(
        {
            "server": "gmail",
            "run_id": run["run_id"],
            "status": "healthy",
            "tools_count": 2,
            "latency_ms": 10,
            "last_checked_at": "2026-05-04T09:00:00Z",
            "last_error": None,
        }
    )

    import asyncio

    asyncio.run(
        emitter.emit(
            {
                "type": "health_check_completed",
                "status": "completed",
                "server": "gmail",
                "message": "gmail MCP service is healthy",
                "metadata": {"server_metadata": {"package": "user-owned-gmail-mcp"}},
            }
        )
    )

    response = client.get("/api/servers/health")

    assert response.status_code == 200
    assert response.json()[0]["metadata"] == {"package": "user-owned-gmail-mcp"}
