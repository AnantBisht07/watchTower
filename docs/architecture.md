# Architecture

MCP Watchtower is a local-first execution cockpit for MCP-powered agents. The Python runtime wraps MCP-like clients, records tool activity in SQLite, and streams the live run journey to a browser UI over Server-Sent Events.

```txt
Agent -> Watchtower wrapper -> MCP service
             |
             +-> SQLite audit store
             +-> in-memory event bus -> FastAPI SSE -> React UI
```

## Runtime Pieces

- `Watchtower`: public entrypoint that creates a run, owns the SQLite store, event bus, emitter, health checker, and optional safety policy.
- `WatchtowerMCPClient`: transparent wrapper around a client with `call_tool(...)`; emits requested, started, completed, failed, timeout, approval, and rejection events.
- `EventEmitter`: normalizes event payloads, persists them, updates derived tables, and publishes live events.
- `SQLiteStore`: stores runs, events, MCP server health, approvals, and tool reliability counters.
- `HealthChecker`: calls `list_tools()` on MCP-like clients, measures latency, stores health, and emits health events.
- `FastAPI server`: exposes run/event/approval/health/reliability endpoints and serves the built React UI.

## Data Flow

1. The agent calls `wrapped_client.call_tool("read_file", {"path": "README.md"})`.
2. The wrapper emits `tool_call_requested`.
3. If a safety policy requires approval, the wrapper emits `approval_required` and waits for a persisted decision.
4. The wrapper emits `tool_call_started`, calls the underlying client, then emits a terminal lifecycle event.
5. The emitter stores each event in SQLite and publishes it to subscribers on the in-memory bus.
6. Browser clients connected to `/api/runs/{run_id}/events/stream` receive historical events first, then live events.

## Local-First Boundaries

SQLite is the only V1 database. There is no hosted service, remote telemetry sink, or external queue. The default database path is `.watchtower/watchtower.db`.
