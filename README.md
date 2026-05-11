# MCP Watchtower

MCP Watchtower is a local-first control tower for MCP-powered agents.

It sits between your agent and MCP servers, records every tool-call event in SQLite, streams live run activity to a browser UI, checks MCP server health, and pauses risky tool calls behind human approval gates.

The goal is simple: when an agent uses tools, you should be able to see what it is doing, which server it is calling, what Watchtower intercepted, and why a tool was approved, rejected, blocked, failed, or completed.

```txt
User task
   |
   v
Agent
   |
   v
MCP Watchtower  ->  SQLite audit trail
   |
   +-> policy check / approval gate
   |
   v
MCP server tool
   |
   v
Tool result
```

## Why This Exists

MCP agents can call powerful tools: filesystem writes, email sends, repository actions, calendar changes, browser automation, and more. Standard logs often make it hard to answer basic questions:

- What tool did the agent ask for?
- Which MCP server received the call?
- Did a policy check happen?
- Was the call paused before execution?
- Who approved or rejected it?
- What did the tool return?
- Is the MCP server healthy?

Watchtower turns those questions into a live execution cockpit and a durable flight recorder.

## What You Get

- Live browser UI for MCP runs
- Agent route map from user task to tool result
- Server-Sent Events stream for run events
- SQLite-backed audit history
- MCP server health checks
- Approval gates for risky tools
- Tool lifecycle tracking: requested, started, completed, failed, timed out
- Policy decisions: allowed, approval required, blocked
- Demo runs for showing the experience quickly

## Current Status

This is an early local-first prototype. It is useful for demos, local development, and experimenting with safer MCP execution flows. Treat it as alpha software before using it around sensitive production tools.

## Quickstart

From the repository root:

```powershell
python -m venv .venv
.\.venv\Scripts\activate
python -m pip install -e ".[dev,server]"

cd web
npm.cmd install
npm.cmd run build
cd ..

python -m mcp_watchtower.cli demo --port 8123
```

Open:

```txt
http://127.0.0.1:8123/
```

If port `8123` is busy, use another port:

```powershell
python -m mcp_watchtower.cli demo --port 8124
```

## Demo Modes

The UI has two built-in demo buttons.

**Journey Demo**

Shows a normal MCP run with server health, tool discovery, tool request, tool result, and completed audit trail.

**Safety Demo**

Shows a risky tool call that pauses before execution:

```txt
filesystem.write_file wants to modify summary.md
```

Watchtower stops the MCP call at the approval gate. You can choose:

- Approve and Forward
- Reject and Block

## The UI

The frontend is designed as an AI Agent Control Tower and Flight Recorder.

It is organized around these areas:

- Header: product name, demo actions, compact run selector
- Status hero: what is happening right now
- Agent route map: user task -> agent -> Watchtower -> policy -> approval -> MCP server -> result
- Inspector: selected event, current tool call, pending approval, and server health details
- Audit trail: timestamped event log for the run
- Health panel: compact MCP server health cards

During an approval pause, the UI makes it clear that the MCP tool has not executed yet. Watchtower has intercepted the call and is waiting for a human decision.

## Using Watchtower With Your MCP Client

Your app still creates and authenticates MCP clients as usual. Watchtower wraps the client and records calls.

```python
from mcp_watchtower import Watchtower

watchtower = Watchtower(
    app_name="repo-agent",
    db_path=".watchtower/watchtower.db",
    safety=True,
)

github = watchtower.wrap_mcp_client(
    raw_github_mcp_client,
    server_name="github",
    server_metadata={
        "transport": "stdio",
        "package": "your-github-mcp-server",
    },
)

await watchtower.check_mcp_server(
    "github",
    raw_github_mcp_client,
    transport="stdio",
)

issues = await github.call_tool(
    "search_issues",
    {"repo": "owner/repo", "query": "is:issue is:open"},
)
```

Start the UI against the same SQLite database:

```powershell
python -m mcp_watchtower.cli ui --db-path .watchtower/watchtower.db --port 8123
```

Open:

```txt
http://127.0.0.1:8123/
```

## Approval Gates

Enable default safety behavior with:

```python
watchtower = Watchtower(
    app_name="repo-writer-agent",
    db_path=".watchtower/watchtower.db",
    safety=True,
)
```

Then wrap the MCP client:

```python
filesystem = watchtower.wrap_mcp_client(
    raw_filesystem_mcp_client,
    server_name="filesystem",
)

await filesystem.call_tool("write_file", {"path": "summary.md"})
```

With `safety=True`, Watchtower classifies common state-changing tools. For example:

- `read_*` style tools are usually allowed
- `write_*` and `send_*` style tools can require approval
- `delete_*` style tools can be blocked

When approval is required, the wrapped call waits until the UI or API approves or rejects the request.

## Custom Policies

Use a YAML policy file when you want explicit rules:

```python
watchtower = Watchtower(
    app_name="repo-writer-agent",
    db_path=".watchtower/watchtower.db",
    policy_path="watchtower.policy.yaml",
)
```

Example:

```yaml
rules:
  - match:
      server: "filesystem"
      tool: "*write*"
    action: require_approval
    risk: medium
    reason: "Writing files requires human approval."

  - match:
      tool: "*delete*"
    action: block
    risk: high
    reason: "Delete tools are blocked locally."

  - match:
      tool: "*"
    action: allow
    risk: low
    reason: "Default allow."
```

See `watchtower.policy.example.yaml` for a starter policy.

## HTTP API

The UI uses these endpoints:

```txt
GET  /api/runs
POST /api/runs
POST /api/runs/demo
POST /api/runs/safety-demo
GET  /api/runs/{run_id}
GET  /api/runs/{run_id}/events
GET  /api/runs/{run_id}/events/stream
GET  /api/servers/health
GET  /api/tools/reliability
GET  /api/approvals
POST /api/approvals/{approval_id}/approve
POST /api/approvals/{approval_id}/reject
```

The live UI subscribes to:

```txt
GET /api/runs/{run_id}/events/stream
```

That stream emits Server-Sent Events for run, health, tool, and approval lifecycle events.

## Event Lifecycle

A typical safe run looks like this:

```txt
run_started
health_check_completed
tools_discovered
tool_call_requested
tool_call_started
tool_call_completed
run_completed
```

A safety-gated run can look like this:

```txt
run_started
health_check_completed
agent_step_started
tool_call_requested
approval_required
tool_call_approved
tool_call_started
tool_call_completed
agent_step_completed
run_completed
```

If the user rejects the request:

```txt
tool_call_rejected
run_failed
```

## Frontend Development

Run the React UI with Vite:

```powershell
cd web
npm.cmd install
npm.cmd run dev
```

The dev server runs at:

```txt
http://127.0.0.1:5173/
```

Vite proxies `/api` to:

```txt
http://127.0.0.1:8000
```

If your backend is running on another port, either run the backend on `8000` for frontend development or update `web/vite.config.ts`.

For production-style local serving, build the frontend and start the Python server:

```powershell
cd web
npm.cmd run build
cd ..
python -m mcp_watchtower.cli demo --port 8123
```

## Tests

Python tests:

```powershell
pytest
```

Frontend build:

```powershell
cd web
npm.cmd run build
```

Playwright e2e tests:

```powershell
cd web
npx.cmd playwright test
```

## Project Layout

```txt
mcp_watchtower/
  bus.py              # in-process event bus for live streams
  cli.py              # demo/ui server commands
  emitter.py          # event creation and persistence
  events.py           # normalized event payload model
  fake_runner.py      # built-in demo runs
  health.py           # MCP health checks
  mcp_wrapper.py      # wrapper around MCP-like clients
  safety.py           # policy and risk classification
  server.py           # FastAPI API and frontend server
  storage.py          # SQLite persistence
  watchtower.py       # main SDK entrypoint

web/src/
  App.tsx
  components/         # control tower UI components
  lib/                # API and event helpers
  styles.css
  types.ts

docs/
  architecture.md
  event_model.md
  integration.md
  policies.md
  sqlite_schema.md
```

## Troubleshooting

**Port 8000 is already in use**

Use another port:

```powershell
python -m mcp_watchtower.cli demo --port 8123
```

**The UI loads but demo buttons fail**

You may be running the frontend dev server without the Python API server. Start the backend too:

```powershell
python -m mcp_watchtower.cli demo --port 8000
```

**A hosted browser cannot open `127.0.0.1`**

Hosted environments cannot access your local machine. Use a tunnel such as ngrok or Cloudflare Tunnel if you need a public URL.

**Approval never completes**

Make sure the UI is pointed at the same SQLite database as the process that created the run.

## Documentation

- `docs/architecture.md`: runtime architecture and data flow
- `docs/event_model.md`: stored and streamed event payloads
- `docs/sqlite_schema.md`: SQLite tables and derived data
- `docs/policies.md`: approval policy format
- `docs/integration.md`: wrapper, health check, and API integration guide
- `mcp_watchtower_high_level_design.md`: original product design
- `mcp_watchtower_research_and_stack.md`: market and stack analysis
- `mcp_watchtower_phase_plan.md`: implementation plan

## License

MIT. See `LICENSE`.
