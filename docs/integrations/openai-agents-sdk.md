# OpenAI Agents SDK Integration

The [OpenAI Agents SDK](https://openai.github.io/openai-agents-python/) lets you build multi-agent workflows with tool use via MCP.  
Watchtower wraps the MCP client sessions inside your agent to provide observability, safety gates, and exporters.

## How it works

The OpenAI Agents SDK creates `ClientSession` objects when it connects to MCP servers.  
Watchtower's `wrap_mcp_session()` adapter wraps those sessions so every `list_tools` / `call_tool` is intercepted.

## Quick start

### 1. Install

```bash
pip install mcp-watchtower mcp openai-agents
```

### 2. Wrap the MCP session

```python
import asyncio
from agents import Agent, Runner
from agents.mcp import MCPServerStdio
from mcp_watchtower import Watchtower
from mcp_watchtower.adapters.mcp_sdk import wrap_mcp_session

async def main():
    wt = Watchtower(
        app_name="openai-agent",
        task="Research competitors and write a report",
        ui=True,
        safety=True,
    )

    async with MCPServerStdio(
        params={
            "command": "npx",
            "args": ["-y", "@modelcontextprotocol/server-brave-search"],
            "env": {"BRAVE_API_KEY": "..."},
        }
    ) as server:
        # Wrap the internal session before passing to the agent
        server._session = wrap_mcp_session(
            server._session, wt, server_name="brave-search"
        )

        agent = Agent(
            name="ResearchAgent",
            instructions="You are a research assistant. Use tools to gather information.",
            mcp_servers=[server],
        )

        result = await Runner.run(agent, "Find the top 5 AI coding assistants")
        print(result.final_output)

    await wt.emit({"type": "run_completed", "status": "completed", "message": "done"})

asyncio.run(main())
```

### 3. Using the multi-run context manager

For workflows with multiple sub-tasks, use `Watchtower.run_context()`:

```python
wt = Watchtower(app_name="pipeline", ui=True)

async def run_subagent(task: str, server_session):
    async with wt.run_context(task=task) as run:
        wrapped = run.wrap_mcp_client(server_session, server_name="tools")
        # ... agent logic using wrapped ...

# Run sub-tasks in sequence; each gets its own run in the Watchtower UI
await run_subagent("Gather data", session_a)
await run_subagent("Summarise results", session_b)
```

Each sub-task appears as a separate run in the Watchtower UI with its own event timeline.

## Safety policy

Block or gate dangerous operations:

```yaml
# policy.yaml
rules:
  - server: brave-search
    tool: "*"
    action: allow

  - server: filesystem
    tool: write_file
    action: require_approval

  - server: shell
    tool: execute_command
    action: block
```

```python
wt = Watchtower(
    app_name="openai-agent",
    policy_path="policy.yaml",
)
```

## Exporting traces

Send traces to LangSmith or Langfuse alongside OpenAI's own tracing:

```python
from mcp_watchtower.exporters.langfuse import LangfuseExporter

exporter = LangfuseExporter(
    public_key="pk-...",
    secret_key="sk-...",
)
wt = Watchtower(app_name="openai-agent", exporters=[exporter])
```

## CLI tools for debugging

```bash
# Replay a completed run's event log
mcp-watchtower replay run_abc123

# Export a run to JSON for offline analysis
mcp-watchtower export run_abc123 --output run_abc123.json

# Import a run into a different database
mcp-watchtower import run_abc123.json --db-path analysis.db
```
