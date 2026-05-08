# Integration Guide

Watchtower is SDK-first: your app creates and authenticates MCP clients as usual, then wraps those clients so calls are visible in the local UI.

Wrap any MCP-like client that exposes `call_tool(tool_name, arguments)` or the official Python MCP SDK-style `call_tool(name=..., arguments=...)`:

```python
from mcp_watchtower import Watchtower

watchtower = Watchtower(
    "repo-agent",
    db_path=".watchtower/watchtower.db",
    safety=True,
)
client = watchtower.wrap_mcp_client(
    raw_mcp_client,
    server_name="filesystem",
    server_metadata={"transport": "stdio", "package": "your-filesystem-mcp"},
)

result = await client.call_tool("read_file", {"path": "README.md"})
```

Check service health when the client exposes `list_tools()`:

```python
health = await watchtower.check_mcp_server(
    "filesystem",
    raw_mcp_client,
    transport="stdio",
    server_metadata={"package": "your-filesystem-mcp"},
)
```

Start the local UI against the same SQLite database:

```bash
python -m mcp_watchtower.cli ui --db-path .watchtower/watchtower.db
```

Then open `http://127.0.0.1:8000`.

Use `python -m mcp_watchtower.cli demo` only for the built-in sample runs.

## API Endpoints

- `GET /api/runs`
- `POST /api/runs`
- `GET /api/runs/{run_id}`
- `GET /api/runs/{run_id}/events`
- `GET /api/runs/{run_id}/events/stream`
- `GET /api/servers/health`
- `GET /api/tools/reliability`
- `GET /api/approvals`
- `POST /api/approvals/{approval_id}/approve`
- `POST /api/approvals/{approval_id}/reject`
