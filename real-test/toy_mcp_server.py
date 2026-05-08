"""Tiny stdio MCP-style server used by real-test/run_watchtower_test.py.

Protocol: one JSON request per line, one JSON response per line.
Supported methods:
- list_tools
- call_tool
"""

from __future__ import annotations

import json
import sys
from datetime import UTC, datetime


TOOLS = [
    {
        "name": "get_status",
        "description": "Return current status from the toy MCP service.",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "create_note",
        "description": "Create a note in the toy MCP service.",
        "input_schema": {
            "type": "object",
            "properties": {"title": {"type": "string"}, "body": {"type": "string"}},
            "required": ["title", "body"],
        },
    },
]


def main() -> None:
    notes: list[dict[str, str]] = []
    for line in sys.stdin:
        if not line.strip():
            continue
        request = json.loads(line)
        response = handle_request(request, notes)
        print(json.dumps(response), flush=True)


def handle_request(request: dict, notes: list[dict[str, str]]) -> dict:
    request_id = request.get("id")
    method = request.get("method")
    try:
        if method == "list_tools":
            return {"id": request_id, "result": {"tools": TOOLS}}

        if method == "call_tool":
            params = request.get("params") or {}
            tool_name = params.get("name")
            arguments = params.get("arguments") or {}
            result = call_tool(tool_name, arguments, notes)
            return {"id": request_id, "result": result}

        raise ValueError(f"unknown method: {method}")
    except Exception as exc:
        return {
            "id": request_id,
            "error": {"code": exc.__class__.__name__, "message": str(exc)},
        }


def call_tool(tool_name: str, arguments: dict, notes: list[dict[str, str]]) -> dict:
    if tool_name == "get_status":
        return {
            "service": "toy-mcp",
            "status": "ready",
            "notes_count": len(notes),
            "checked_at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        }

    if tool_name == "create_note":
        note = {
            "id": f"note_{len(notes) + 1}",
            "title": str(arguments["title"]),
            "body": str(arguments["body"]),
        }
        notes.append(note)
        return note

    raise ValueError(f"unknown tool: {tool_name}")


if __name__ == "__main__":
    main()
