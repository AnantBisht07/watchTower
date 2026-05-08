# MCP Watchtower

Local-first live execution cockpit for MCP-powered agents.

MCP Watchtower sits between an agent and MCP services, records tool-call activity in SQLite, and streams the run journey to a browser UI in real time.

```txt
User -> Agent -> Watchtower runtime -> MCP service -> Result
                         |
                         v
                 Live UI + SQLite audit store
```

## What It Does

- Shows live MCP agent/tool execution.
- Streams run events over Server-Sent Events.
- Stores run and event history in SQLite.
- Displays MCP service health.
- Provides the foundation for approval gates around risky tools.

## Quickstart

```bash
python -m venv .venv
.venv\Scripts\activate
python -m pip install -e ".[dev,server]"
cd web
npm.cmd install
npm.cmd run build
cd ..
python -m mcp_watchtower.cli demo
```

Open:

```txt
http://127.0.0.1:8000
```

Use **Journey demo** for scripted timeline events, or **Safety demo** to run a wrapped state-changing tool call that pauses until you approve or reject it in the UI.

## Use With Your MCP Client

Install Watchtower in the same Python environment as your agent:

```bash
python -m pip install "mcp-watchtower[server]"
```

Add the wrapper around the MCP client you already create:

```python
from mcp_watchtower import Watchtower

watchtower = Watchtower(
    app_name="gmail-agent",
    db_path=".watchtower/watchtower.db",
    safety=True,
)

gmail = watchtower.wrap_mcp_client(
    raw_gmail_mcp_client,
    server_name="gmail",
    server_metadata={
        "transport": "stdio",
        "package": "your-gmail-mcp-server",
    },
)

await watchtower.check_mcp_server(
    "gmail",
    raw_gmail_mcp_client,
    transport="stdio",
    server_metadata={"package": "your-gmail-mcp-server"},
)

emails = await gmail.call_tool("search_emails", {"query": "is:unread"})
```

Start the UI against the same database:

```bash
mcp-watchtower ui --db-path .watchtower/watchtower.db
```

Watchtower does not own your Gmail, Slack, GitHub, or filesystem credentials. Your app creates and authenticates those MCP clients as usual; Watchtower observes the wrapped tool calls.

Frontend development:

```bash
cd web
npm.cmd install
npm.cmd run dev
```

## Core API

```python
from mcp_watchtower import Watchtower

watchtower = Watchtower(app_name="repo-analyzer-agent")
mcp_client = watchtower.wrap_mcp_client(mcp_client, server_name="github")
```

Enable the local approval gate for state-changing tools:

```python
watchtower = Watchtower(app_name="repo-writer-agent", safety=True)
mcp_client = watchtower.wrap_mcp_client(mcp_client, server_name="filesystem")

await mcp_client.call_tool("write_file", {"path": "summary.md"})
```

With `safety=True`, tools with names like `write_file` or `send_email` pause until approved, while tools with names like `delete_file` are blocked by the default policy.

Check MCP service health from an MCP-like client:

```python
health = await watchtower.check_mcp_server(
    "github",
    mcp_client,
    transport="stdio",
)
```

The health checker calls `list_tools()`, measures latency, stores the result in SQLite, and emits live health events for the UI.

Tool reliability is tracked automatically from lifecycle events:

- success count
- failure count
- timeout count
- average latency
- last error

Read it from:

```txt
GET /api/tools/reliability
```

Use a local policy file when you want explicit rules:

```python
watchtower = Watchtower(
    app_name="repo-writer-agent",
    policy_path="watchtower.policy.yaml",
)
```

Policy example:

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

Run the wrapper demo:

```bash
python examples/safety_wrapper_demo/main.py
```

Open an existing Watchtower database:

```bash
python -m mcp_watchtower.cli ui --db-path .watchtower/watchtower.db
```

## Project Docs

- `mcp_watchtower_high_level_design.md`: original product design.
- `mcp_watchtower_research_and_stack.md`: market and stack analysis.
- `mcp_watchtower_phase_plan.md`: implementation plan.
- `docs/architecture.md`: runtime architecture and data flow.
- `docs/event_model.md`: stored and streamed event payloads.
- `docs/sqlite_schema.md`: local SQLite tables and derived data.
- `docs/policies.md`: approval policy format.
- `docs/integration.md`: wrapper, health check, and API integration guide.
