# MCP Watchtower Phase Plan

## Summary

Build MCP Watchtower as an open-source, local-first live execution cockpit for MCP-powered agents. For V1, MCP servers are treated as the service layer.

```txt
User -> Agent -> Watchtower runtime -> MCP service -> Result
                         |
                         v
                 Live UI + SQLite audit store
```

SQLite is the only V1 database. JSONL can be added later as an export format, but it is not the primary storage layer.

## Key Decisions

- Backend: Python 3.11+, FastAPI, Uvicorn, Pydantic-compatible JSON APIs, SSE, MCP Python SDK later.
- Database: SQLite only, local-first, created under `.watchtower/watchtower.db` by default.
- Frontend: Vite, React, TypeScript, Tailwind CSS, Radix UI primitives, Lucide icons.
- Transport: SSE for backend-to-browser live events, HTTP POST for approvals later.
- Package shape: simple repo layout first, not a monorepo.
- Positioning: not an MCP Inspector clone, not a LangSmith clone, not an enterprise MCP gateway.

## Phase Plan

### Phase 0: Project Foundation

- Create Python package structure for `mcp_watchtower`.
- Add `pyproject.toml` with runtime and dev dependencies.
- Add frontend app under `web/`.
- Add README with local-first positioning, quickstart, and roadmap.
- Add focused tests for the dependency-light core.

### Phase 1: Event System And SQLite Store

- Define the base event model with `event_id`, `run_id`, `type`, `timestamp`, `status`, `message`, and optional MCP fields.
- Implement an event emitter that validates events, assigns IDs/timestamps, publishes to an in-memory bus, and persists to SQLite.
- Create SQLite tables for `runs`, `events`, `mcp_servers`, and `approvals`.
- Add tests for event creation, event ordering, persistence, and run lookup.

### Phase 2: FastAPI Runtime And SSE

- Add FastAPI app with endpoints for creating/listing runs and reading run events.
- Add SSE endpoint: `GET /api/runs/{run_id}/events/stream`.
- Stream newly emitted events in real time from the in-memory event bus.
- Rehydrate past events from SQLite when a run page opens.
- Add a fake runner that emits a full sample journey.

### Phase 3: Live Browser UI

- Build a single-page run view at `/runs/:runId`.
- Show run header, current status, elapsed time, server health, live timeline, and event details.
- Use browser `EventSource` for SSE.
- Render tool inputs and output summaries in expandable detail panels.
- Keep the UI operational and dense, not a marketing landing page.

### Phase 4: MCP Client Wrapper

- Implement `Watchtower.wrap_mcp_client(client)` as the main V1 integration.
- Intercept MCP tool calls and emit tool call lifecycle events.
- Measure latency and summarize outputs without storing hidden model reasoning.
- Preserve the original MCP client behavior and return values.

### Phase 5: MCP Service Health

- Add health checks for configured MCP services.
- Track connection status, tool count, latency, last checked time, and last error in SQLite.
- Emit health events and update the UI health panel live.
- Start with explicit configured services rather than auto-discovering everything.

### Phase 6: Approval Gate

- Add simple local policy rules using YAML.
- Support actions: `allow`, `require_approval`, and `block`.
- Add approval events and UI approve/reject controls.
- Tool execution pauses only when a rule requires approval.
- Store approval decisions in SQLite.

### Phase 7: Hardening And Public Release

- Add tests for event flow, SQLite persistence, SSE streaming, MCP wrapper behavior, health checks, and approval decisions.
- Add example apps: fake agent demo first, real MCP client demo second.
- Add docs for architecture, event model, SQLite schema, MCP wrapping, and policies.
- Prepare `mcp-watchtower` package metadata for open-source release.

## Public Interfaces

- `Watchtower(app_name: str, ui: bool = True, db_path: str | None = None, health_checks: bool = True, safety: bool = False, policy_path: str | None = None)`
- `watchtower.wrap_mcp_client(client, server_name: str | None = None)`
- `await watchtower.check_mcp_server(server_name: str, client, transport: str | None = None, timeout_s: float | None = None)`
- `watchtower.emit(event)`
- `GET /api/runs`
- `GET /api/runs/{run_id}`
- `GET /api/runs/{run_id}/events`
- `GET /api/runs/{run_id}/events/stream`
- `POST /api/approvals/{approval_id}/approve`
- `POST /api/approvals/{approval_id}/reject`

## Test Plan

- Unit test event validation, timestamping, IDs, and SQLite writes.
- Unit test event replay from SQLite.
- Integration test SSE receives emitted events in order.
- Integration test fake runner produces a complete run.
- Wrapper test confirms successful, failed, and timed-out MCP calls emit correct events.
- UI smoke test confirms timeline, health panel, and event drawer render.
- Approval test confirms risky tools pause and approved tools continue.

## Assumptions

- SQLite is the only V1 database.
- JSONL is not part of V1 storage.
- Python SDK comes first; TypeScript SDK is a later expansion.
- The first milestone is the fake live run, before real MCP integration.
