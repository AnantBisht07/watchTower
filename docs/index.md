# MCP Watchtower

**A live control layer for MCP-powered agents.**

MCP Watchtower sits between your agent and MCP servers, records every tool-call event in SQLite, streams live run activity to a browser UI, checks MCP server health, and pauses risky tool calls behind human approval gates.

```
User task → Agent → MCP Watchtower → MCP server tool → Result
                         │
                         ├─ SQLite audit trail
                         ├─ Policy check / approval gate
                         └─ Live browser UI (SSE)
```

## Quick links

- [Quickstart](quickstart.md)
- [Architecture](architecture.md)
- [Integration guide](integration.md)
- [Policy reference](policies.md)
- [Event model](event_model.md)

## Why this exists

MCP agents can call powerful tools — filesystem writes, email sends, repository actions, browser automation. Standard logs make it hard to answer:

- What tool did the agent ask for?
- Did a policy check happen?
- Was the call paused before execution?
- Who approved or rejected it?
- Is the MCP server healthy?

Watchtower turns those questions into a **live execution cockpit** and a **durable flight recorder**.

## Install

```bash
pip install mcp-watchtower[server]
python -m mcp_watchtower.cli demo --port 8123
```

Open `http://127.0.0.1:8123/`
