# MCP Watchtower Research And Tech Stack

> Working note created from market research and the existing high-level design.
> Goal: make the idea stronger without copying existing products.

---

## 1. Current Market Read

MCP is now a serious integration layer for AI applications. The official MCP architecture defines a host, one MCP client per server, and MCP servers that expose tools, resources, and prompts. That makes MCP servers a natural "service layer" for V1.

The market around this is splitting into four categories:

1. MCP server developer tools
2. LLM/agent observability platforms
3. MCP gateways and security proxies
4. Agent SDK guardrail/tracing systems

MCP Watchtower should not try to replace all of them. The stronger position is narrower:

> A local-first live execution cockpit for MCP-powered agents.

That means the project focuses on what happens during a run:

- what the agent is doing now
- which MCP service is being called
- what input was sent
- what came back
- what failed
- what needs approval
- whether connected MCP services are healthy

---

## 2. Existing Products And What They Mean For Us

### MCP Inspector

MCP Inspector is useful for manually testing and debugging MCP servers. It is a server-side development tool.

Implication:

MCP Watchtower should not be positioned as "better MCP Inspector." Inspector helps test a server. Watchtower should show live agent-to-MCP execution during an actual run.

### Langfuse, Phoenix, LangSmith-Style Observability

These tools are strong at traces, spans, evaluations, prompt iteration, datasets, experiments, production monitoring, and post-run debugging.

Implication:

MCP Watchtower should not compete as a full LLM observability suite. The first product surface should be live, operational, and MCP-specific. Later, it can export traces to OpenTelemetry, Phoenix, or Langfuse instead of replacing them.

### OpenAI Agents SDK Tracing And Guardrails

Modern agent SDKs already include tracing and guardrails around agents, model calls, handoffs, and function tools.

Implication:

Watchtower should be framework-neutral. It should work at the MCP client/tool boundary, not only inside one agent SDK.

### MCP Gateways

There are now gateway products and open-source projects for routing, auth, lifecycle management, centralized policy, audit logs, Kubernetes deployment, and enterprise governance.

Implication:

Watchtower should avoid becoming a heavy enterprise gateway in V1. It can later integrate with gateways, but the first open-source value should be local visibility and human control for developers.

### Security-First MCP Proxies

Some tools already focus on policy enforcement, approval gates, and audit logs for MCP tool calls.

Implication:

Approval alone is not enough differentiation. The stronger wedge is the combined experience:

- live journey UI
- MCP service health
- tool-call timeline
- local audit log
- simple approval gate
- developer-friendly SDK wrapper

The product should feel like a run cockpit, not only a policy proxy.

---

## 3. Original Positioning

Avoid:

- "MCP gateway"
- "LLM observability platform"
- "LangSmith alternative"
- "MCP Inspector alternative"
- "enterprise agent security platform"

Use:

> MCP Watchtower is a local-first control and visibility layer for MCP-powered agents.

Developer tagline:

> Watch MCP tool calls happen live, inspect failures, check service health, and pause risky actions before they execute.

Short pitch:

> Agents are no longer just text generators. They call services. MCP Watchtower shows those calls as a live run timeline and gives developers a control point before risky service actions happen.

---

## 4. Product Boundary

For V1, treat MCP servers as services.

```txt
User
  -> Agent
    -> Watchtower runtime
      -> MCP service
        -> Result
```

Responsibilities:

- Agent: plans and decides what to call
- Watchtower: observes, records, streams, summarizes, and gates
- MCP service: performs the real action
- UI: renders the live run state

This boundary is clean because it avoids changing the agent's reasoning logic and avoids owning the MCP server implementation.

---

## 5. What Makes The Idea Solid

The strongest open-source version should optimize for:

### 1. Fast Local Demo

A developer should run one command and see a live agent journey in the browser.

### 2. MCP-Native Events

The event model should understand:

- MCP server
- MCP transport
- tool name
- tool arguments
- tool result summary
- latency
- health status
- approval state

### 3. Human-Readable Timeline

The UI should convert raw events into plain operational language.

Example:

```txt
Calling github.search_issues
Completed in 1.4s with 34 results
filesystem.write_file is waiting for approval
```

### 4. Local Auditability

JSONL files are correct for V1. They make the project transparent and easy to debug.

### 5. Export Later, Do Not Build Everything Now

Design events so they can map to OpenTelemetry later, especially tool execution spans. Do not make OpenTelemetry a V1 dependency.

---

## 6. Recommended V1 Tech Stack

### Language

Python first.

Reasons:

- strong fit for AI agent developers
- good FastAPI/SSE ecosystem
- official MCP Python SDK exists
- simple packaging for local developer tooling
- easier fake runner and examples

Add TypeScript SDK later only after the Python runtime proves the model.

### Backend Runtime

- Python 3.11+
- FastAPI
- Uvicorn
- sse-starlette
- Pydantic v2
- AnyIO
- MCP Python SDK

Backend responsibilities:

- run lifecycle
- event validation
- in-memory pub/sub
- SSE event stream
- JSONL persistence
- MCP client wrapping
- fake demo runner
- health checks
- approval request state

### Frontend

- Vite
- React
- TypeScript
- Tailwind CSS
- Radix UI primitives
- Lucide icons
- EventSource API for SSE

Frontend responsibilities:

- live timeline
- server health table
- current run header
- tool-call detail drawer
- approval panel
- raw JSON expansion for events

Keep the UI as a real app, not a landing page.

### Storage

V1:

- JSONL event log
- one run directory per run
- metadata JSON per run

```txt
.watchtower/
  runs/
    run_abc123/
      metadata.json
      events.jsonl
```

V2:

- SQLite optional backend

V3:

- Postgres or external observability export

### Event Transport

V1:

- SSE from backend to browser
- HTTP POST from browser to backend for approvals

Do not use WebSockets in V1 unless bidirectional streaming becomes necessary.

### Policy And Approval

V1.5 or V2:

- YAML policy file
- simple risk classifier
- allow, require_approval, block
- local approval UI

Example:

```yaml
rules:
  - match:
      tool: "*.read*"
    action: allow
    risk: low

  - match:
      tool: "filesystem.write_file"
    action: require_approval
    risk: medium

  - match:
      tool: "*.delete*"
    action: block
    risk: high
```

### Packaging

- uv for Python project management
- pyproject.toml
- ruff for linting
- mypy or pyright for type checks
- pytest for tests
- pnpm for frontend package management
- Playwright for UI smoke tests
- GitHub Actions for CI

### Repo Shape

Start simple:

```txt
mcp-watchtower/
  README.md
  pyproject.toml
  mcp_watchtower/
    __init__.py
    watchtower.py
    events.py
    emitter.py
    storage.py
    bus.py
    server.py
    mcp_wrapper.py
    health.py
    safety.py
  web/
    package.json
    index.html
    src/
      App.tsx
      api/
      components/
      styles.css
  examples/
    fake_agent_demo/
      main.py
    mcp_client_demo/
      main.py
  docs/
    architecture.md
    events.md
    policies.md
```

Avoid a packages/ monorepo until there is a second SDK.

---

## 7. Event Model Direction

Use a small internal event schema first.

Required fields:

- event_id
- run_id
- type
- timestamp
- status
- message

Common optional fields:

- parent_event_id
- server
- transport
- tool
- input
- output_summary
- latency_ms
- risk
- approval_id
- error
- metadata

Keep private model reasoning out of events. Record operational actions, not hidden chain-of-thought.

---

## 8. MVP Milestones

### Milestone 1: Fake Live Run

Deliver:

- FastAPI server
- SSE stream
- React timeline
- fake event runner
- JSONL event log

This proves the product experience.

### Milestone 2: MCP Wrapper

Deliver:

- wrapper around MCP client tool calls
- before/after/error events
- latency measurement
- output summarizer

### Milestone 3: MCP Service Health

Deliver:

- configured MCP service list
- connection attempt events
- tool listing
- latency
- health panel

### Milestone 4: Approval Gate

Deliver:

- rule-based policy
- approval_required event
- UI approve/reject
- blocked or approved tool execution path

### Milestone 5: Export Layer

Deliver:

- optional OpenTelemetry exporter
- map tool call events to GenAI tool execution spans
- keep local JSONL as default

---

## 9. Key Design Decisions

### Be MCP-Native, But Not MCP-Only Forever

The first implementation should target MCP. The event model can later support direct REST tools, function tools, or agent SDK tools.

### Be Local-First

Local-first is the open-source advantage. It avoids cloud setup, privacy concerns, and enterprise complexity.

### Be Live Before Analytical

The core UI should answer "what is happening now?" before it answers "what happened across 10,000 runs?"

### Be A Control Surface, Not Just A Dashboard

The UI should eventually affect execution through approvals and rejections. That is a stronger product than passive tracing.

### Design For Security Without Claiming To Solve All Security

V1 can classify obvious risk and require approval. It should not claim complete sandboxing, identity, or compliance.

---

## 10. Better Build Order

Recommended implementation order:

1. Python event schema and emitter
2. JSONL storage
3. FastAPI SSE server
4. React live timeline
5. fake demo runner
6. health panel with fake data
7. MCP client wrapper
8. real health checks
9. policy file
10. approval gate
11. optional OpenTelemetry export

This order protects the core idea: first prove the live journey.

---

## 11. Strategic Differentiation

MCP Watchtower should own this sentence:

> The fastest way to see and control what your MCP-powered agent is doing right now.

That is different from:

- testing an MCP server manually
- collecting traces for later analysis
- deploying an enterprise gateway
- building a full authorization platform

The open-source project should feel small, useful, and immediate.

---

## 12. Research Sources

- MCP architecture: https://modelcontextprotocol.io/docs/learn/architecture
- MCP Inspector: https://modelcontextprotocol.io/docs/tools/inspector
- MCP security best practices: https://modelcontextprotocol.io/specification/2025-06-18/basic/security_best_practices
- MCP authorization: https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization
- OpenTelemetry GenAI semantic conventions: https://opentelemetry.io/docs/specs/semconv/gen-ai/
- OpenTelemetry GenAI tool spans: https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/
- Langfuse overview: https://langfuse.com/docs
- Arize Phoenix overview: https://arize.com/docs/phoenix
- OpenAI Agents SDK tracing: https://openai.github.io/openai-agents-python/tracing/
- OpenAI Agents SDK guardrails: https://openai.github.io/openai-agents-python/guardrails/
- Docker MCP Gateway: https://docs.docker.com/ai/mcp-gateway/
- Microsoft MCP Gateway: https://microsoft.github.io/mcp-gateway/
- Agentgateway MCP authorization: https://agentgateway.dev/docs/mcp/mcp-authz/
- ContextForge AI Gateway: https://ibm.github.io/mcp-context-forge/
- Cordon MCP security gateway: https://getcordon.com/
