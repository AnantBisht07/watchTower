# Cursor Integration

[Cursor](https://cursor.sh) is an AI-powered editor that can connect to MCP servers through its settings.  
Watchtower intercepts those connections to give you a live audit trail of every tool call.

## How it works

Cursor supports MCP servers configured in `.cursor/mcp.json`.  
You point Cursor at a Watchtower proxy script instead of the upstream MCP server.

```
Cursor → Watchtower proxy → upstream MCP server
```

## Quick start

### 1. Install

```bash
pip install mcp-watchtower mcp
```

### 2. Create a proxy script

```python
# watchtower_cursor_proxy.py
import asyncio
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from mcp_watchtower import Watchtower
from mcp_watchtower.adapters.mcp_sdk import wrap_mcp_session

SERVERS = {
    "filesystem": StdioServerParameters(
        command="npx",
        args=["-y", "@modelcontextprotocol/server-filesystem", "/Users/you/projects"],
    ),
}

async def main():
    wt = Watchtower(app_name="cursor", ui=True, safety=True)

    async with stdio_client(SERVERS["filesystem"]) as (read, write):
        async with ClientSession(read, write) as session:
            wrapped = wrap_mcp_session(session, wt, server_name="filesystem")
            await wrapped.list_tools()
            await asyncio.sleep(float("inf"))

asyncio.run(main())
```

### 3. Configure Cursor

Create or edit `.cursor/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "python",
      "args": ["/absolute/path/to/watchtower_cursor_proxy.py"]
    }
  }
}
```

Reload Cursor. Every MCP tool call Cursor makes is now visible at `http://127.0.0.1:8123`.

## Approval gates for file writes

Prevent Cursor from writing files without your confirmation:

```yaml
# policy.yaml
rules:
  - server: filesystem
    tool: write_file
    action: require_approval
  - server: filesystem
    tool: create_directory
    action: require_approval
```

```python
wt = Watchtower(
    app_name="cursor",
    policy_path="policy.yaml",
    ui=True,
)
```

When Cursor tries to write a file, Watchtower pauses the call and shows an **Approve / Reject** button in the UI.

## Webhook notifications

Get a Slack ping whenever Cursor requests a potentially risky tool:

```python
wt = Watchtower(
    app_name="cursor",
    webhooks={
        "approval_required": "https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK",
    },
)
```

## Replaying a session

```bash
# List recent runs
mcp-watchtower ui --db-path .watchtower/watchtower.db

# Print events for a specific run
mcp-watchtower replay run_abc123
```
