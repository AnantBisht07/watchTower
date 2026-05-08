# SQLite Schema

The default database is `.watchtower/watchtower.db`.

## Tables

- `runs`: one row per agent run.
- `events`: append-only event log with typed columns plus the full raw JSON payload.
- `mcp_servers`: latest health status by MCP server name.
- `approvals`: local approval requests and decisions.
- `mcp_tool_stats`: aggregate reliability counters by server/tool.

## Retention

V1 does not enforce automatic retention. The database is local and can be archived or deleted by the user. Tests should use explicit temp database paths to avoid polluting the local demo database.

## Derived Data

`mcp_tool_stats` is updated from terminal tool lifecycle events:

- `tool_call_completed` increments success count.
- `tool_call_failed` increments failure count.
- `tool_call_timeout` increments timeout count.

Average latency is computed from accumulated latency across terminal tool events.
