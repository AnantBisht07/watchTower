# MCP Watchtower

**A live control layer for MCP-powered agents.**

MCP Watchtower sits between your agent and MCP servers, records every tool-call event in SQLite, streams live run activity to a browser UI, checks MCP server health, and pauses risky tool calls behind human approval gates.

```txt
User task
   |
   v
Agent
   |
   v
MCP Watchtower  ──►  SQLite audit trail
   |
   +──► policy check / approval gate
   |
   v
MCP server tool
   |
   v
Tool result
```

> **Status: Alpha.** Useful for demos, local development, and experimenting with safer MCP execution flows. Not yet production-ready.

---

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

---

## What You Get

| Feature | Description |
|---|---|
| Live browser UI | Real-time control tower for MCP runs |
| Agent route map | Visual path from user task to tool result |
| SSE event stream | Live run events pushed to the browser |
| SQLite audit trail | Durable, queryable history of every event |
| MCP server health | Latency, tool count, and error status per server |
| Approval gates | Pause risky tool calls for human review |
| Tool lifecycle tracking | requested → started → completed / failed / timed out |
| Policy decisions | allowed / approval required / blocked |
| Tool reliability stats | Success/failure counts and average latency per tool |
| Demo runs | Built-in demos to show the experience immediately |

---

## Quickstart

### macOS / Linux

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev,server]"

cd web
npm install
npm run build
cd ..

python -m mcp_watchtower.cli demo --port 8123
```

### Windows (PowerShell)

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

Open `http://127.0.0.1:8123/` in your browser.

---

## Demo Modes

The UI has two built-in demo buttons.

### Journey Demo

Shows a normal MCP run: server health, tool discovery, tool request, and tool result, all streaming live.

### Safety Demo

Shows a risky tool call that pauses for approval:

```txt
filesystem.write_file wants to modify summary.md
```

Watchtower stops the MCP call at the approval gate. You choose:

- **Approve and Forward** — the tool executes
- **Reject and Block** — the tool is cancelled

---

## The UI

The frontend is designed as an AI Agent Control Tower and Flight Recorder.

```txt
┌─────────────────────────────────────────────────────────┐
│ MCP Watchtower          [Journey Demo] [Safety Demo]    │
│ Run: run_abc123                         Status: Live    │
├─────────────────────────────────────────────────────────┤
│ Server Health                                           │
│ ✅ github       healthy   18 tools   140ms              │
│ ✅ filesystem   healthy    6 tools    31ms              │
│ ❌ browser      timeout    0 tools  5000ms              │
├────────────────────────────┬────────────────────────────┤
│ Agent Route Map            │ Inspector                  │
│                            │                            │
│ Task → Agent → Watchtower  │ Tool: filesystem.write_file│
│   → Policy → Approval      │ Risk: medium               │
│   → MCP Server → Result    │ Input: {"path":"summary.md"}
│                            │                            │
│ Event Timeline             │ [Approve] [Reject]         │
│ ✅ run_started             │                            │
│ ✅ health_check_completed  │                            │
│ ⏳ approval_required       │                            │
└────────────────────────────┴────────────────────────────┘
```

---

## Integrating With Your Agent

Your app creates and authenticates MCP clients as usual. Watchtower wraps the client and records calls.

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

```bash
python -m mcp_watchtower.cli ui --db-path .watchtower/watchtower.db --port 8123
```

> **Note:** The CLI server and the agent must run in the same process for live SSE streaming to work. If you run them separately, the audit history will be readable but live events will not stream. This is a known limitation tracked in the roadmap.

---

## Approval Gates

Enable default safety behavior:

```python
watchtower = Watchtower(
    app_name="repo-writer-agent",
    db_path=".watchtower/watchtower.db",
    safety=True,
)

filesystem = watchtower.wrap_mcp_client(
    raw_filesystem_mcp_client,
    server_name="filesystem",
)

await filesystem.call_tool("write_file", {"path": "summary.md"})
```

With `safety=True`, Watchtower classifies tools by name pattern:

| Pattern | Default action |
|---|---|
| `*read*`, `*list*`, `*search*` | allow |
| `*write*`, `*send*`, `*create*` | require approval |
| `*delete*`, `*remove*` | block |

When approval is required, the wrapped call waits until the UI or API approves or rejects the request.

---

## Custom Policies

Use a YAML policy file for explicit rules:

```python
watchtower = Watchtower(
    app_name="repo-writer-agent",
    db_path=".watchtower/watchtower.db",
    policy_path="watchtower.policy.yaml",
)
```

```yaml
# watchtower.policy.yaml
# First matching rule wins. Wildcards use shell-style fnmatch.

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

See [`watchtower.policy.example.yaml`](watchtower.policy.example.yaml) for a complete starter policy.

---

## HTTP API

```txt
GET  /api/runs
POST /api/runs
POST /api/runs/demo
POST /api/runs/safety-demo
GET  /api/runs/{run_id}
GET  /api/runs/{run_id}/events
GET  /api/runs/{run_id}/events/stream     ← SSE live stream
GET  /api/servers/health
GET  /api/tools/reliability
GET  /api/approvals
POST /api/approvals/{approval_id}/approve
POST /api/approvals/{approval_id}/reject
```

---

## Event Lifecycle

A normal run:

```txt
run_started
health_check_completed
tools_discovered
tool_call_requested
tool_call_started
tool_call_completed
run_completed
```

A safety-gated run:

```txt
run_started
health_check_completed
agent_step_started
tool_call_requested
approval_required          ← UI shows approve/reject
tool_call_approved
tool_call_started
tool_call_completed
agent_step_completed
run_completed
```

If the user rejects:

```txt
tool_call_rejected
run_failed
```

---

## Frontend Development

```bash
cd web
npm install
npm run dev        # dev server at http://127.0.0.1:5173/
```

Vite proxies `/api` to `http://127.0.0.1:8000` during development. Run the Python backend on port 8000 or adjust `web/vite.config.ts`.

---

## Tests

```bash
# Python unit and integration tests
pytest

# Frontend build check
cd web && npm run build

# Playwright end-to-end tests
cd web && npx playwright test
```

---

## Project Layout

```txt
mcp_watchtower/
  bus.py              in-process event bus for live streams
  cli.py              demo/ui server CLI commands
  emitter.py          event normalization and persistence
  events.py           normalized event payload model
  fake_runner.py      built-in demo runs
  health.py           MCP health checks
  mcp_wrapper.py      transparent wrapper around MCP-like clients
  safety.py           policy and risk classification
  server.py           FastAPI API and frontend server
  storage.py          SQLite persistence
  watchtower.py       main SDK entrypoint

web/src/
  App.tsx
  components/         control tower UI components
  lib/                API and event helpers
  types.ts

docs/
  architecture.md     runtime architecture and data flow
  event_model.md      stored and streamed event payloads
  sqlite_schema.md    SQLite tables and derived data
  policies.md         approval policy format
  integration.md      wrapper, health check, and API guide
  analysis.md         full codebase analysis and improvement plan
```

---

## Roadmap

### Now (v0.1 — current)
- Live timeline streaming over SSE
- SQLite audit trail
- Safety approval gates
- MCP server health checks
- Tool reliability stats
- React control tower UI

### Next (v0.2)
- Official `mcp` Python SDK adapter (`mcp.ClientSession` → `WatchtowerMCPClient`)
- Replace approval polling with async event signaling
- Implement `ui=True` to auto-start the browser UI
- Publish to PyPI (`pip install mcp-watchtower`)
- Cross-process live streaming (SQLite polling fallback for SSE)
- API token authentication for approval endpoints

### Later (v0.3+)
- Argument-aware policy rules (e.g., block writes to `/etc/`)
- OpenTelemetry export
- Langfuse / LangSmith trace export
- Tool reliability dashboard panel in UI
- Multi-run orchestrator support

---

## Troubleshooting

**Port already in use**

```bash
python -m mcp_watchtower.cli demo --port 8124
```

**UI loads but demo buttons fail**

Start the Python backend too:

```bash
python -m mcp_watchtower.cli demo --port 8000
```

**Approval never completes**

Make sure the UI and the process that created the run share the same SQLite database path.

**A hosted browser cannot open `127.0.0.1`**

Use a tunnel such as ngrok or Cloudflare Tunnel if you need a public URL.

---

## Documentation

| File | Description |
|---|---|
| `docs/architecture.md` | Runtime architecture and data flow |
| `docs/event_model.md` | Stored and streamed event payloads |
| `docs/sqlite_schema.md` | SQLite tables and derived data |
| `docs/policies.md` | Approval policy format |
| `docs/integration.md` | Wrapper, health check, and API guide |
| `docs/analysis.md` | Full codebase analysis and improvement plan |
| `mcp_watchtower_high_level_design.md` | Original product design spec |
| `mcp_watchtower_research_and_stack.md` | Market and stack research |
| `mcp_watchtower_phase_plan.md` | Implementation phase plan |

---

## License

MIT. See [`LICENSE`](LICENSE).
