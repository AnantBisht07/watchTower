# Event Model

Events are normalized dictionaries with a small required core and optional MCP-specific fields.

## Required Fields

- `event_id`: generated ID such as `evt_...`
- `run_id`: run that owns the event
- `type`: event type, such as `tool_call_completed`
- `timestamp`: UTC ISO timestamp
- `status`: current event status
- `message`: human-readable summary
- `metadata`: object for source-specific details

## Optional Fields

- `parent_event_id`
- `server`
- `transport`
- `tool`
- `input`
- `output_summary`
- `latency_ms`
- `risk`
- `approval_id`
- `reason`
- `error`

## Common Event Types

- `run_started`, `run_completed`, `run_failed`
- `health_check_started`, `health_check_completed`, `health_check_failed`
- `tools_discovered`
- `tool_call_requested`, `tool_call_started`, `tool_call_completed`
- `tool_call_failed`, `tool_call_timeout`
- `approval_required`, `tool_call_approved`, `tool_call_rejected`

Full raw event payloads are stored in SQLite. Tool outputs are summarized by default so large or sensitive result bodies are not copied wholesale into the audit log.
