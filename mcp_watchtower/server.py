"""FastAPI server for the Watchtower UI and API."""

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
from typing import AsyncIterator

from .bus import EventBus
from .emitter import EventEmitter
from .fake_runner import run_fake_journey, run_safety_gate_demo
from .storage import SQLiteStore


class WatchtowerRuntime:
    def __init__(self, db_path: str | Path | None = None) -> None:
        self.store = SQLiteStore(db_path)
        self.bus = EventBus()

    def create_run(self, app_name: str = "fake-agent-demo", task: str | None = None) -> dict:
        return self.store.create_run(app_name=app_name, task=task)

    def emitter_for(self, run_id: str) -> EventEmitter:
        return EventEmitter(run_id, self.store, self.bus)


def create_app(app_runtime: WatchtowerRuntime | None = None, api_token: str | None = None):
    try:
        from fastapi import Depends, FastAPI, HTTPException, Request
        from fastapi.responses import FileResponse, HTMLResponse, StreamingResponse
        from fastapi.staticfiles import StaticFiles
    except ImportError as exc:  # pragma: no cover - exercised only without server deps.
        raise RuntimeError(
            "FastAPI server dependencies are missing. Install with: "
            'python -m pip install -e ".[server]"'
        ) from exc

    _token = api_token or os.environ.get("WATCHTOWER_API_TOKEN")

    async def require_auth(request: Request) -> None:
        if not _token:
            return  # Auth disabled — local-only default
        auth = request.headers.get("Authorization", "")
        if auth != f"Bearer {_token}":
            raise HTTPException(status_code=401, detail="invalid or missing API token")

    if app_runtime is None:
        raise RuntimeError(
            "create_app() requires an explicit WatchtowerRuntime. "
            "Use the CLI or pass app_runtime directly."
        )
    active_runtime = app_runtime
    app = FastAPI(title="MCP Watchtower", version="0.1.0")
    web_dist = Path(__file__).resolve().parent.parent / "web" / "dist"

    if web_dist.exists():
        assets = web_dist / "assets"
        if assets.exists():
            app.mount("/assets", StaticFiles(directory=assets), name="assets")

    @app.get("/api/runs")
    async def list_runs() -> list[dict]:
        return active_runtime.store.list_runs()

    @app.post("/api/runs")
    async def create_run(payload: dict | None = None, _: None = Depends(require_auth)) -> dict:
        payload = payload or {}
        run = active_runtime.create_run(
            app_name=payload.get("app_name", "watchtower-demo"),
            task=payload.get("task"),
        )
        return run

    @app.post("/api/runs/demo")
    async def create_demo_run(_: None = Depends(require_auth)) -> dict:
        run = active_runtime.create_run(app_name="fake-agent-demo", task="Show a live MCP journey")
        emitter = active_runtime.emitter_for(run["run_id"])
        asyncio.create_task(run_fake_journey(emitter, active_runtime.store))
        return run

    @app.post("/api/runs/safety-demo")
    async def create_safety_demo_run(_: None = Depends(require_auth)) -> dict:
        run = active_runtime.create_run(
            app_name="safety-gate-demo",
            task="Pause a real wrapped tool call until approval",
        )
        emitter = active_runtime.emitter_for(run["run_id"])
        asyncio.create_task(run_safety_gate_demo(emitter, active_runtime.store))
        return run

    @app.get("/api/runs/{run_id}")
    async def get_run(run_id: str) -> dict:
        run = active_runtime.store.get_run(run_id)
        if not run:
            raise HTTPException(status_code=404, detail="run not found")
        return run

    @app.post("/api/runs/{run_id}/emit")
    async def emit_event(run_id: str, payload: dict, _: None = Depends(require_auth)) -> dict:
        if not active_runtime.store.get_run(run_id):
            raise HTTPException(status_code=404, detail="run not found")
        emitter = active_runtime.emitter_for(run_id)
        return await emitter.emit(payload)

    @app.get("/api/runs/{run_id}/events")
    async def list_events(run_id: str) -> dict:
        if not active_runtime.store.get_run(run_id):
            raise HTTPException(status_code=404, detail="run not found")
        return {
            "run": active_runtime.store.get_run(run_id),
            "events": active_runtime.store.list_events(run_id),
        }

    @app.get("/api/runs/{run_id}/events/stream")
    async def stream_events(run_id: str):
        if not active_runtime.store.get_run(run_id):
            raise HTTPException(status_code=404, detail="run not found")

        async def event_stream() -> AsyncIterator[str]:
            queue = await active_runtime.bus.subscribe(run_id)
            seen_ids: set[str] = set()

            try:
                # Always replay history first (works in both in-process and cross-process).
                for event in active_runtime.store.list_events(run_id):
                    seen_ids.add(event["event_id"])
                    yield _sse(event["type"], event)

                while True:
                    try:
                        # In-process path: event arrives via EventBus (zero latency).
                        event = await asyncio.wait_for(queue.get(), timeout=0.5)
                        if event["event_id"] not in seen_ids:
                            seen_ids.add(event["event_id"])
                            yield _sse(event["type"], event)
                    except asyncio.TimeoutError:
                        # Cross-process fallback: poll SQLite for new rows.
                        new_events = active_runtime.store.list_events_after(run_id, seen_ids)
                        if new_events:
                            for event in new_events:
                                seen_ids.add(event["event_id"])
                                yield _sse(event["type"], event)
                        else:
                            yield ": keep-alive\n\n"
            finally:
                await active_runtime.bus.unsubscribe(run_id, queue)

        return StreamingResponse(event_stream(), media_type="text/event-stream")

    @app.get("/api/servers/health")
    async def list_server_health() -> list[dict]:
        health = active_runtime.store.list_server_health()
        for item in health:
            item["metadata"] = active_runtime.store.get_latest_server_metadata(item["server"])
        return health

    @app.get("/api/events/recent")
    async def list_recent_events(limit: int = 30) -> list[dict]:
        return active_runtime.store.list_recent_events(limit=min(limit, 100))

    @app.get("/api/tools/reliability")
    async def list_tool_reliability() -> list[dict]:
        return active_runtime.store.list_tool_reliability()

    @app.get("/api/approvals")
    async def list_approvals(run_id: str | None = None) -> list[dict]:
        return active_runtime.store.list_approvals(run_id=run_id)

    @app.post("/api/approvals/{approval_id}/approve")
    async def approve(approval_id: str, _: None = Depends(require_auth)) -> dict:
        return await _decide_approval(approval_id, "approved")

    @app.post("/api/approvals/{approval_id}/reject")
    async def reject(approval_id: str, _: None = Depends(require_auth)) -> dict:
        return await _decide_approval(approval_id, "rejected")

    async def _decide_approval(approval_id: str, decision: str) -> dict:
        approval, changed = active_runtime.store.decide_approval(approval_id, decision)
        if approval is None:
            raise HTTPException(status_code=404, detail="approval not found")

        source_event = active_runtime.store.get_event_by_approval_id(approval_id) or {}
        source_metadata = source_event.get("metadata") or {}
        should_emit_decision = source_metadata.get("source") != "mcp_client_wrapper"
        if changed and should_emit_decision:
            event_type = "tool_call_approved" if decision == "approved" else "tool_call_rejected"
            status = "completed" if decision == "approved" else "rejected"
            server = source_event.get("server")
            tool = source_event.get("tool")
            display = ".".join(part for part in [server, tool] if part)
            message = (
                f"Approved {display or approval_id}"
                if decision == "approved"
                else f"Rejected {display or approval_id}"
            )
            emitter = active_runtime.emitter_for(approval["run_id"])
            await emitter.emit(
                {
                    "type": event_type,
                    "status": status,
                    "parent_event_id": source_event.get("event_id"),
                    "server": server,
                    "tool": tool,
                    "risk": approval.get("risk"),
                    "approval_id": approval_id,
                    "message": message,
                    "metadata": {"decision": decision},
                }
            )

        return approval

    @app.get("/")
    async def index():
        index_file = web_dist / "index.html"
        if index_file.exists():
            return FileResponse(index_file)
        return HTMLResponse(_fallback_html())

    @app.get("/{full_path:path}")
    async def spa_fallback(full_path: str):
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="not found")
        index_file = web_dist / "index.html"
        if index_file.exists():
            return FileResponse(index_file)
        return HTMLResponse(_fallback_html())

    return app


def _sse(event_type: str, payload: dict) -> str:
    return f"event: {event_type}\ndata: {json.dumps(payload)}\n\n"


def _fallback_html() -> str:
    return """
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>MCP Watchtower</title>
        <style>
          body { font-family: Inter, system-ui, sans-serif; margin: 40px; color: #17202a; }
          button { padding: 10px 14px; border: 1px solid #0f766e; background: #0f766e; color: white; border-radius: 6px; }
          pre { background: #f3f4f6; padding: 16px; border-radius: 6px; overflow: auto; }
        </style>
      </head>
      <body>
        <h1>MCP Watchtower</h1>
        <p>Build the frontend with <code>cd web && npm.cmd install && npm.cmd run build</code>, or start a demo run below.</p>
        <button onclick="startDemo()">Start demo run</button>
        <pre id="out"></pre>
        <script>
          async function startDemo() {
            const run = await fetch('/api/runs/demo', { method: 'POST' }).then(r => r.json());
            const out = document.getElementById('out');
            out.textContent = `Run: ${run.run_id}\\n`;
            const events = new EventSource(`/api/runs/${run.run_id}/events/stream`);
            events.onmessage = (event) => { out.textContent += event.data + '\\n'; };
            [
              'run_started', 'health_check_completed', 'health_check_failed',
              'health_check_started',
              'tools_discovered', 'tool_call_requested', 'tool_call_completed',
              'tool_call_started', 'tool_call_approved', 'tool_call_rejected',
              'approval_required', 'run_completed', 'run_failed'
            ].forEach(type => events.addEventListener(type, e => {
              const payload = JSON.parse(e.data);
              out.textContent += `${payload.timestamp} ${payload.message}\\n`;
            }));
          }
        </script>
      </body>
    </html>
    """


