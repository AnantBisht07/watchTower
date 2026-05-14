# Cline Integration

[Cline](https://github.com/cline/cline) is a VS Code extension that uses MCP servers to give Claude access to tools like filesystem, GitHub, databases, and more.

Watchtower wraps Cline's MCP connections to add a live event stream, safety policies, and approval gates — visible in a local browser UI while you code.

## How it works

Cline spawns MCP server processes and communicates via stdio.  
You run a small Watchtower proxy between Cline and each upstream MCP server.

```
Cline → Watchtower proxy → MCP server
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
    args=["-y", "@modelcontextprotocol/server-github"],
    env={"GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_..."},
)

async def main():
    wt = Watchtower(
        app_name="cline",
        ui=True,
        db_path=".watchtower/cline.db",
    )
    async with stdio_client(UPSTREAM) as (read, write):
        async with ClientSession(read, write) as session:
            wrapped = wrap_mcp_session(session, wt, server_name="github")
            await wrapped.list_tools()
            await asyncio.sleep(float("inf"))

asyncio.run(main())
```

### 3. Configure Cline

In VS Code settings (`Ctrl+Shift+P` → "Cline: Open MCP Settings"):

```json
{
  "mcpServers": {
    "github": {
      "command": "python",
      "args": ["/path/to/watchtower_proxy.py"],
      "disabled": false
    }
  }
}
```

Restart Cline. Watchtower logs every tool call at `http://127.0.0.1:8123`.

## Watching multiple servers

Wrap each server with the same `Watchtower` instance:

```python
wt = Watchtower(app_name="cline", ui=True)

# Open connections to each server and wrap them
github_wrapped  = wrap_mcp_session(github_session,  wt, server_name="github")
fs_wrapped      = wrap_mcp_session(fs_session,      wt, server_name="filesystem")
db_wrapped      = wrap_mcp_session(db_session,      wt, server_name="postgres")
```

All servers appear in the same Watchtower UI run.

## Exporting to LangSmith

```python
from mcp_watchtower.exporters.langsmith import LangSmithExporter

exporter = LangSmithExporter(api_key="ls__...", project_name="cline-sessions")
wt = Watchtower(app_name="cline", exporters=[exporter])
```
