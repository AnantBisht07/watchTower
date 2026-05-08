# MCP Watchtower — High-Level Design Spec

> Codex context file  
> Project goal: Build a lightweight, developer-friendly runtime layer that sits between an AI agent and MCP tools, then shows the agent’s live execution journey in real time, with future support for safety approvals and MCP tool reliability.

---

## 1. One-Line Product Pitch

**MCP Watchtower is “Google Maps for MCP agent execution.”**

It shows where the agent is in its journey, what tool it is calling, what came back, what failed, what needs approval, and whether the connected MCP tools are healthy.

---

## 2. Why This Project Exists

AI agents are becoming powerful because they can use tools. With MCP, agents can connect to external systems like:

- filesystem
- GitHub
- databases
- browsers
- Slack
- calendars
- internal APIs

But once agents start using real tools, three big problems appear:

### Problem 1: Visibility

Agents feel like a black box.

A user gives a task, then waits. They do not know:

- Is the agent thinking?
- Is it calling a tool?
- Which tool?
- What input did it send?
- Did the tool fail?
- Is the agent stuck?
- What happened before the final answer?

### Problem 2: Safety

Agents can perform risky actions.

Examples:

- write files
- delete files
- run shell commands
- send emails
- create pull requests
- deploy apps
- modify databases

The user needs a way to pause and approve risky actions before they happen.

### Problem 3: Reliability

Agents often depend on many MCP servers/tools.

In real life:

- one MCP server may be down
- auth may fail
- a tool may timeout
- a server may expose zero tools
- a tool schema may be invalid
- a result may be malformed
- latency may be too high

The agent should not silently fail. The user should know which tool/server is broken and why.

---

## 3. Core Mental Model

Normal MCP agent flow:

```txt
User → Agent → MCP Server/Tool → Result
```

MCP Watchtower flow:

```txt
User → Agent → MCP Watchtower Layer → MCP Server/Tool → Result
                     ↓
              Live Journey UI
              Safety Gate
              Tool Health
              Audit Log
```

MCP Watchtower is not the agent.

MCP Watchtower is not the MCP server.

MCP Watchtower is the runtime observation/control layer between the agent and MCP tools.

---

## 4. Difference From Existing Observability Tools

LangSmith / Langfuse-style tools are mainly tracing and observability dashboards. They are useful for debugging and post-run analysis.

MCP Watchtower is more focused on the live user/developer experience:

```txt
Agent is running
↓
Live UI shows current step
↓
Risky tool call appears
↓
User can approve/reject
↓
Tool health is visible
↓
Agent continues or stops
```

This project should feel less like a trace table and more like a live execution route.

Analogy:

```txt
Google Maps does not only show final route.
It shows:
- current location
- next step
- traffic
- warnings
- ETA
- blocked routes

MCP Watchtower should show:
- current agent step
- next tool call
- MCP server status
- tool input
- tool output summary
- latency
- errors
- approval requirements
```

---

## 5. Product Positioning

Do not position this as:

- another LangSmith
- another MCP Inspector
- another enterprise gateway
- another agent framework

Position it as:

> **A live control layer for MCP agents.**

Possible tagline:

> **See, approve, and debug MCP agent tool calls in real time.**

Better developer tagline:

> **A lightweight runtime layer that turns MCP tool calls into a live journey UI, approval gates, and health signals.**

---

## 6. Target Users

### Primary user

Developers building MCP-based AI agents who want to understand what their agent is doing in real time.

### Secondary users

- AI engineers building internal tools
- Agent framework builders
- Open-source MCP developers
- Developers debugging MCP server connections
- Teams building human-in-the-loop agent workflows

---

## 7. V1 Scope

V1 should be small and clear.

### V1 Name

Use one of these:

- `mcp-watchtower`
- `mcp-agent-control-plane`
- `mcp-journey`
- `agent-route`

Preferred for now:

```txt
mcp-watchtower
```

### V1 Goal

Build a local developer tool that shows MCP agent/tool execution in real time.

### V1 Features

#### 1. Live Agent Journey Timeline

Show events as they happen.

Example:

```txt
🟢 Agent started
🔌 Connecting to GitHub MCP server
✅ GitHub MCP server connected
🧰 Tool discovered: github.search_issues
🛠 Tool call requested: github.search_issues
📤 Input sent to tool
📥 Tool result received
🧠 Agent processing result
🏁 Agent completed
```

#### 2. MCP Tool Call Interception

The SDK should wrap MCP tool calls and emit events:

- before tool call
- after tool call
- on error
- on timeout

#### 3. Live Browser UI

A simple UI that receives events in real time through SSE or WebSocket.

For V1, prefer **Server-Sent Events (SSE)** because it is simpler than WebSocket.

#### 4. Basic MCP Server Health

Show whether MCP servers are reachable.

Example:

```txt
✅ filesystem   healthy   6 tools   31ms
✅ github       healthy   18 tools  140ms
❌ browser      timeout   0 tools   5000ms
```

#### 5. JSON Audit Log

Save run events as JSON.

Example output:

```txt
.watchtower/runs/run_abc123/events.jsonl
```

Each line should be one event JSON object.

---

## 8. Not In V1

Do not build these in the first version:

- full enterprise policy engine
- OAuth
- cryptographic agent identity
- complex RBAC
- multi-tenant cloud dashboard
- distributed tracing backend
- OpenTelemetry integration
- LangSmith competitor
- production auth system
- complex graph visualization
- advanced replay debugger
- token-by-token reasoning viewer
- hidden chain-of-thought viewer

Important:

MCP Watchtower should show operational events, not private model reasoning.

Good:

```txt
Agent called github.search_issues
Tool returned 12 issues
Approval required for filesystem.write_file
```

Avoid:

```txt
The model's private hidden reasoning
```

---

## 9. V1 Architecture

```txt
┌────────────────────────┐
│ User App / Agent       │
└───────────┬────────────┘
            │
            ▼
┌────────────────────────┐
│ MCP Watchtower SDK     │
│                        │
│ - wraps MCP client     │
│ - intercepts tool call │
│ - emits events         │
│ - stores audit log     │
│ - checks health        │
└───────────┬────────────┘
            │
            ▼
┌────────────────────────┐
│ MCP Client             │
└───────────┬────────────┘
            │
            ▼
┌────────────────────────┐
│ MCP Servers            │
│ filesystem, GitHub...  │
└────────────────────────┘


Side channel:

MCP Watchtower SDK
        ↓
Event Bus
        ↓
SSE/WebSocket Server
        ↓
Live Browser UI
```

---

## 10. Package API — Desired Developer Experience

A developer should be able to install the package and wrap their MCP client or agent.

### Install

```bash
pip install mcp-watchtower
```

### Example usage

```python
from mcp_watchtower import Watchtower

watchtower = Watchtower(
    app_name="repo-analyzer-agent",
    ui=True,
    audit_log=True,
)

mcp_client = watchtower.wrap_mcp_client(mcp_client)

# normal agent code continues
result = await agent.run("Analyze this repo and find beginner issues")
```

### Alternative agent wrapper

```python
from mcp_watchtower import Watchtower

watchtower = Watchtower(ui=True)

agent = watchtower.wrap_agent(agent)

await agent.run("Analyze this repo")
```

For V1, wrapping the MCP client/tool execution path is more important than wrapping every possible agent framework.

---

## 11. Event Model

Events are the core of the product.

Every important action becomes an event.

### Base Event Schema

```json
{
  "event_id": "evt_123",
  "run_id": "run_456",
  "parent_event_id": null,
  "type": "tool_call_requested",
  "timestamp": "2026-05-03T10:30:00Z",
  "status": "pending",
  "message": "Agent requested tool github.search_issues",
  "metadata": {}
}
```

### Recommended Event Types

```txt
run_started
run_completed
run_failed

agent_started
agent_step_started
agent_step_completed
agent_completed
agent_failed

mcp_server_connecting
mcp_server_connected
mcp_server_failed
mcp_server_disconnected

tools_discovered
tool_call_requested
tool_call_started
tool_call_completed
tool_call_failed
tool_call_timeout

approval_required
tool_call_approved
tool_call_rejected

health_check_started
health_check_completed
health_check_failed
```

### Tool Call Event Example

```json
{
  "event_id": "evt_tool_001",
  "run_id": "run_abc123",
  "type": "tool_call_requested",
  "timestamp": "2026-05-03T10:30:00Z",
  "status": "pending",
  "server": "github",
  "tool": "search_issues",
  "risk": "low",
  "message": "Agent wants to call github.search_issues",
  "input": {
    "repo": "lastmile-ai/mcp-agent",
    "query": "is:issue is:open"
  },
  "metadata": {
    "source": "mcp_client_wrapper"
  }
}
```

### Tool Result Event Example

```json
{
  "event_id": "evt_tool_002",
  "run_id": "run_abc123",
  "parent_event_id": "evt_tool_001",
  "type": "tool_call_completed",
  "timestamp": "2026-05-03T10:30:02Z",
  "status": "completed",
  "server": "github",
  "tool": "search_issues",
  "latency_ms": 1432,
  "message": "github.search_issues completed",
  "output_summary": {
    "type": "list",
    "count": 34
  }
}
```

### Failed Tool Event Example

```json
{
  "event_id": "evt_tool_003",
  "run_id": "run_abc123",
  "type": "tool_call_failed",
  "timestamp": "2026-05-03T10:30:04Z",
  "status": "failed",
  "server": "browser",
  "tool": "open_page",
  "latency_ms": 5000,
  "message": "browser.open_page timed out",
  "error": {
    "code": "TIMEOUT",
    "detail": "MCP server did not respond within 5 seconds"
  }
}
```

---

## 12. UI Design

The UI should be simple and live.

### Main UI Layout

```txt
┌────────────────────────────────────────────────────────┐
│ MCP Watchtower                                         │
│ Run: run_abc123                         Status: Live   │
├────────────────────────────────────────────────────────┤
│ Server Health                                          │
│ ✅ github       healthy      18 tools       140ms       │
│ ✅ filesystem   healthy       6 tools        31ms       │
│ ❌ browser      timeout       0 tools      5000ms       │
├────────────────────────────────────────────────────────┤
│ Live Agent Journey                                     │
│ 🟢 Agent started                                       │
│ 🔌 Connected to github MCP server                      │
│ 🧰 Discovered 18 tools                                 │
│ 🛠 Calling github.search_issues                        │
│ 📥 Received 34 issues                                  │
│ 🧠 Agent processing tool result                        │
│ ⚠️ Approval required: filesystem.write_file            │
├────────────────────────────────────────────────────────┤
│ Approval Panel                                         │
│ Tool: filesystem.write_file                            │
│ Risk: Medium                                           │
│ Reason: modifies local file                            │
│ Input: {"path": "summary.md"}                          │
│                                                        │
│ [Approve] [Reject]                                     │
└────────────────────────────────────────────────────────┘
```

### UI Pages

For V1, keep one page:

```txt
/runs/:run_id
```

Optional pages later:

```txt
/runs
/servers
/settings
/policies
```

### UI Components

#### 1. Run Header

Shows:

- run id
- task name
- current status
- start time
- elapsed time

#### 2. Server Health Panel

Shows:

- server name
- status
- tool count
- latency
- last error

#### 3. Live Timeline

Shows events in order.

Each event should have:

- icon
- short message
- timestamp
- status
- expandable details

#### 4. Tool Call Detail Drawer

When user clicks a tool call event, show:

- server
- tool name
- input
- output summary
- latency
- error if any

#### 5. Approval Panel

Only appears when approval is needed.

Shows:

- tool name
- risk level
- reason
- arguments
- approve button
- reject button

---

## 13. Real-Time Transport

Use SSE for V1.

### Why SSE?

- simple
- browser-native
- good for one-way server-to-client event streams
- easier than WebSocket
- perfect for timeline updates

### SSE Flow

```txt
SDK emits event
↓
Event bus receives event
↓
SSE endpoint streams event
↓
Browser updates timeline
```

### Example Endpoint

```txt
GET /api/runs/{run_id}/events/stream
```

### Example Event

```txt
event: tool_call_requested
data: {"run_id":"run_abc123","tool":"github.search_issues"}
```

---

## 14. Storage

For V1, keep storage local and simple.

### Event Storage

Use JSONL files:

```txt
.watchtower/
  runs/
    run_abc123/
      events.jsonl
      metadata.json
```

### Why JSONL?

- simple
- append-friendly
- easy to debug
- good enough for local development

Later versions can support:

- SQLite
- Postgres
- OpenTelemetry
- Langfuse export
- LangSmith export

---

## 15. Safety Layer — V2 Scope

Safety should be designed now but implemented after V1 timeline works.

### Goal

Pause before risky MCP tool calls.

### Basic Risk Policy

```python
RISK_RULES = {
    "read_file": "low",
    "search": "low",
    "list_issues": "low",
    "write_file": "medium",
    "delete_file": "high",
    "run_shell": "high",
    "send_email": "high",
    "deploy": "critical",
}
```

### Approval Flow

```txt
Agent requests tool
↓
Watchtower checks risk
↓
If low risk: allow
↓
If medium/high/critical: emit approval_required
↓
UI shows approval panel
↓
User approves/rejects
↓
If approved: call tool
↓
If rejected: return rejection result to agent
```

### Approval Event Example

```json
{
  "event_id": "evt_approval_001",
  "run_id": "run_abc123",
  "type": "approval_required",
  "timestamp": "2026-05-03T10:31:00Z",
  "server": "filesystem",
  "tool": "write_file",
  "risk": "medium",
  "message": "Approval required before filesystem.write_file",
  "reason": "This tool modifies a local file.",
  "input": {
    "path": "summary.md",
    "content_preview": "# Repo Analysis..."
  }
}
```

### Important Safety Principle

Do not pretend to be a complete security product in V1.

V2 safety should be simple:

- rule-based
- transparent
- local-first
- human approval before risky actions

---

## 16. Reliability Layer — V2/V3 Scope

Reliability means the user knows whether tools are usable.

### Health Checks

For each MCP server, check:

- is server reachable?
- does handshake work?
- can tools be listed?
- how many tools are available?
- what is latency?
- what was the last error?
- when did it last succeed?

### Health Status Model

```json
{
  "server": "github",
  "status": "healthy",
  "tools_count": 18,
  "latency_ms": 140,
  "last_checked_at": "2026-05-03T10:30:00Z",
  "last_error": null
}
```

### Status Values

```txt
unknown
checking
healthy
degraded
unhealthy
timeout
auth_failed
disconnected
```

### Tool Reliability Signals

For each tool:

- success count
- failure count
- average latency
- last error
- timeout count

---

## 17. MVP Implementation Plan

### Phase 0 — Fake Prototype

Before integrating real MCP, build fake events.

Goal:

```txt
Prove UI experience first.
```

Create a fake agent runner that emits:

```txt
run_started
mcp_server_connected
tools_discovered
tool_call_requested
tool_call_completed
approval_required
run_completed
```

Show these in the browser in real time.

### Phase 1 — Event System

Build:

- event schema
- event emitter
- in-memory event bus
- JSONL writer
- run id generation

### Phase 2 — SSE UI

Build:

- FastAPI backend
- SSE endpoint
- simple React frontend or HTML/JS frontend
- live timeline

Recommended stack for speed:

Backend:

```txt
Python + FastAPI + sse-starlette
```

Frontend:

```txt
React + Vite
```

or even:

```txt
simple HTML + vanilla JS
```

### Phase 3 — MCP Client Wrapper

Build a wrapper around MCP tool calls.

Pseudo-code:

```python
class WatchtowerMCPClient:
    def __init__(self, client, emitter):
        self.client = client
        self.emitter = emitter

    async def call_tool(self, server_name, tool_name, arguments):
        await self.emitter.emit({
            "type": "tool_call_requested",
            "server": server_name,
            "tool": tool_name,
            "input": arguments,
        })

        start = now()

        try:
            result = await self.client.call_tool(tool_name, arguments)
            latency_ms = elapsed(start)

            await self.emitter.emit({
                "type": "tool_call_completed",
                "server": server_name,
                "tool": tool_name,
                "latency_ms": latency_ms,
                "output_summary": summarize(result),
            })

            return result

        except Exception as e:
            await self.emitter.emit({
                "type": "tool_call_failed",
                "server": server_name,
                "tool": tool_name,
                "error": str(e),
            })
            raise
```

### Phase 4 — Basic Health Checks

Before run starts:

- connect to configured MCP servers
- list tools
- measure latency
- emit health events
- show health panel

### Phase 5 — Basic Approval Gate

Add:

- risk config
- pause on risky tools
- approve/reject UI
- continue/reject execution

---

## 18. Folder Structure

Suggested repo structure:

```txt
mcp-watchtower/
  README.md
  pyproject.toml

  packages/
    python/
      mcp_watchtower/
        __init__.py
        watchtower.py
        events.py
        emitter.py
        storage.py
        mcp_wrapper.py
        health.py
        safety.py
        server.py

  apps/
    web/
      package.json
      src/
        App.tsx
        components/
          RunHeader.tsx
          ServerHealthPanel.tsx
          Timeline.tsx
          TimelineEvent.tsx
          ToolCallDrawer.tsx
          ApprovalPanel.tsx

  examples/
    fake_agent_demo/
      main.py

    mcp_agent_demo/
      main.py

  docs/
    architecture.md
    events.md
    safety.md
    reliability.md
```

For a simpler first repo, skip monorepo and use:

```txt
mcp-watchtower/
  mcp_watchtower/
  web/
  examples/
```

---

## 19. Core Classes

### Watchtower

Main entrypoint.

```python
class Watchtower:
    def __init__(
        self,
        app_name: str,
        ui: bool = True,
        audit_log: bool = True,
        safety: bool = False,
        health_checks: bool = True,
    ):
        ...
```

Responsibilities:

- create run
- create emitter
- start local UI server
- wrap MCP client
- manage audit storage

### EventEmitter

```python
class EventEmitter:
    async def emit(self, event: dict) -> None:
        ...
```

Responsibilities:

- validate event
- attach run_id/timestamp/event_id
- publish to event bus
- write to JSONL

### WatchtowerMCPClient

```python
class WatchtowerMCPClient:
    async def call_tool(self, tool_name: str, arguments: dict):
        ...
```

Responsibilities:

- intercept tool calls
- emit before/after/error events
- call safety policy before risky tools
- measure latency

### HealthChecker

```python
class HealthChecker:
    async def check_server(self, server_config) -> HealthStatus:
        ...
```

Responsibilities:

- connect to server
- list tools
- measure latency
- emit status

### SafetyPolicy

```python
class SafetyPolicy:
    def classify_tool(self, server: str, tool: str, arguments: dict) -> RiskDecision:
        ...
```

Responsibilities:

- classify risk
- decide allow/approval/block
- explain reason

---

## 20. UI Experience Details

### Timeline Event Style

Each event should be readable by a human.

Bad:

```txt
tool_call_requested github.search_issues {query...}
```

Good:

```txt
🛠 Calling github.search_issues
Searching open issues in lastmile-ai/mcp-agent
```

### Event Detail Expansion

Collapsed view:

```txt
🛠 Calling github.search_issues
```

Expanded view:

```json
{
  "repo": "lastmile-ai/mcp-agent",
  "query": "is:issue is:open"
}
```

### Show Current Step

At the top:

```txt
Current Step: Waiting for approval
```

### Show Run Status

```txt
Live
Completed
Failed
Waiting for approval
```

### Show Latency

```txt
github.search_issues completed in 1.4s
```

### Show Errors Clearly

```txt
❌ browser.open_page failed
Reason: timeout after 5s
Suggested action: check whether browser MCP server is running
```

---

## 21. What Makes This Different

This project is not only tracing.

Tracing answers:

```txt
What happened?
```

MCP Watchtower answers:

```txt
What is happening right now?
What is the agent about to do?
Should this action be allowed?
Are the tools healthy?
What failed and why?
```

That is the difference.

---

## 22. Success Criteria For V1

V1 is successful if:

- a developer can install/run a demo locally
- browser opens a live run page
- fake agent events stream in real time
- MCP tool calls appear in the timeline
- MCP server health appears before or during the run
- events are saved to JSONL
- README explains the mental model clearly

Do not overbuild.

---

## 23. README Outline

The README should include:

```md
# MCP Watchtower

Google Maps for MCP agent execution.

## What it does

- Shows live MCP agent/tool execution
- Streams tool calls in real time
- Displays MCP server health
- Saves audit logs
- Future: approval gates for risky tools

## Why

Agents are powerful but invisible.
MCP gives agents tools.
Watchtower makes tool usage visible, controllable, and debuggable.

## Quickstart

pip install mcp-watchtower

## Demo

python examples/fake_agent_demo/main.py

Open:
http://localhost:8000

## Concepts

- Run
- Event
- Timeline
- Tool call
- Server health
- Approval gate

## Roadmap

v0.1 Live timeline
v0.2 Approval gate
v0.3 Reliability dashboard
```

---

## 24. Codex Build Instruction

When implementing, prioritize this order:

1. Create a working fake event streaming demo.
2. Create the event schema and JSONL storage.
3. Create a FastAPI backend with SSE.
4. Create a simple frontend timeline.
5. Add fake MCP server health data.
6. Add real MCP client wrapping.
7. Add approval gate only after timeline works.

Do not start with advanced safety or complex MCP internals.

The first milestone should visually prove:

```txt
An agent run can be shown live as a journey.
```

---

## 25. Final Product Vision

MCP Watchtower should eventually become:

```txt
A lightweight local-first control plane for MCP agents.
```

It should help developers:

- see what the agent is doing
- understand tool calls
- inspect tool inputs/outputs
- catch failures quickly
- approve risky actions
- monitor MCP server health
- save audit logs

Final vision:

> **Agents should not be black boxes. MCP Watchtower makes them visible, controllable, and reliable.**
