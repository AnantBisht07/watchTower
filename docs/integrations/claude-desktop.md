# Claude Desktop Integration

Claude Desktop connects to MCP servers through its `claude_desktop_config.json` file.  
Watchtower wraps those servers at runtime to add visibility, safety, and approval gates — without modifying Claude Desktop itself.

## How it works

You write a small Python script that:

1. Connects to the MCP server(s) Claude Desktop would normally reach directly.
2. Wraps each connection with Watchtower.
3. Exposes a re-wrapped MCP server that Claude Desktop talks to instead.

```
Claude Desktop → your Watchtower proxy script → MCP server
```

## Quick start

### 1. Install

```bash
pip install mcp-watchtower mcp
```

### 2. Create a proxy script

```python
# watchtower_proxy.py
import asyncio
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from mcp_watchtower import Watchtower
from mcp_watchtower.adapters.mcp_sdk import wrap_mcp_session

UPSTREAM = StdioServerParameters(
    command="npx",
    args=["-y", "@modelcontextprotocol/server-filesystem", "/Users/you/Documents"],
)

async def main():
    wt = Watchtower(
        app_name="claude-desktop",
        ui=True,           # opens http://127.0.0.1:8123 in your browser
        safety=True,       # enable approval gates
    )

    async with stdio_client(UPSTREAM) as (read, write):
        async with ClientSession(read, write) as session:
            wrapped = wrap_mcp_session(session, wt, server_name="filesystem")

            # List tools so Claude Desktop can discover them
            tools = await wrapped.list_tools()
            print(f"Proxying {len(tools)} tools via Watchtower")

            # Keep alive — Claude Desktop will call tools through wrapped
            await asyncio.sleep(float("inf"))

asyncio.run(main())
```

### 3. Point Claude Desktop at the proxy

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "filesystem-via-watchtower": {
      "command": "python",
      "args": ["/absolute/path/to/watchtower_proxy.py"]
    }
  }
}
```

Restart Claude Desktop. The proxy starts automatically, Watchtower opens the UI, and every tool call is now observed and controllable.

## Safety policy

Create a `policy.yaml` to restrict what Claude Desktop can do:

```yaml
rules:
  - server: filesystem
    tool: write_file
    action: require_approval

  - server: filesystem
    tool: delete_*
    action: block
```

Pass it to Watchtower:

```python
wt = Watchtower(
    app_name="claude-desktop",
    policy_path="policy.yaml",
)
```

Any `write_file` call will pause until you approve or reject it in the UI.

## Redacting sensitive paths

```python
wt = Watchtower(
    app_name="claude-desktop",
    redact_fields=["api_key", "password", "token"],
    redact_pattern=r"\b[A-Za-z0-9]{32,}\b",  # scrub long tokens
)
```
