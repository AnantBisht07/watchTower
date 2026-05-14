# Quickstart

## Installation

```bash
pip install mcp-watchtower[server]
```

To use the official MCP Python SDK adapter:

```bash
pip install mcp-watchtower[server,mcp]
```

## Run the demo

```bash
# macOS / Linux
python -m mcp_watchtower.cli demo --port 8123

# Windows (PowerShell)
python -m mcp_watchtower.cli demo --port 8123
```

Open `http://127.0.0.1:8123/` — click **Journey Demo** or **Safety Demo**.

## Or use Docker

```bash
docker compose up
```

Open `http://127.0.0.1:8123/`

## Wrap your own MCP client

```python
from mcp_watchtower import Watchtower

watchtower = Watchtower(
    app_name="my-agent",
    db_path=".watchtower/watchtower.db",
    safety=True,
    ui=True,          # starts browser UI automatically
)

# Wrap any client that has .call_tool() and .list_tools()
github = watchtower.wrap_mcp_client(raw_github_client, server_name="github")

result = await github.call_tool("search_issues", {"query": "is:open"})
```

## Use with the official mcp SDK

```python
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from mcp_watchtower import Watchtower
from mcp_watchtower.adapters import wrap_mcp_session

watchtower = Watchtower(app_name="my-agent", safety=True, ui=True)

async with stdio_client(StdioServerParameters(command="npx", args=["-y", "@modelcontextprotocol/server-filesystem", "/tmp"])) as (read, write):
    async with ClientSession(read, write) as session:
        await session.initialize()
        fs = wrap_mcp_session(session, watchtower, server_name="filesystem")
        result = await fs.call_tool("read_file", {"path": "/tmp/hello.txt"})
```

## View a past run

```bash
python -m mcp_watchtower.cli ui --db-path .watchtower/watchtower.db --port 8123
```

## Replay a run

```bash
python -m mcp_watchtower.cli replay run_abc123 --db-path .watchtower/watchtower.db
```

## Export a run

```bash
python -m mcp_watchtower.cli export run_abc123 --db-path .watchtower/watchtower.db > run.jsonl
```
