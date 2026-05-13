"""Adapter for the official `mcp` Python SDK (mcp.ClientSession).

Install the optional dependency:
    pip install mcp-watchtower[mcp]

Usage:
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client
    from mcp_watchtower import Watchtower
    from mcp_watchtower.adapters import wrap_mcp_session

    watchtower = Watchtower(app_name="my-agent", safety=True)

    async with stdio_client(StdioServerParameters(command="npx", args=["-y", "@modelcontextprotocol/server-filesystem", "/tmp"])) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            fs = wrap_mcp_session(session, watchtower, server_name="filesystem")
            await watchtower.check_mcp_server("filesystem", fs)
            result = await fs.call_tool("read_file", {"path": "/tmp/hello.txt"})
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    pass


class _MCPSessionBridge:
    """Bridges mcp.ClientSession to the WatchtowerMCPClient duck-typed interface."""

    def __init__(self, session: Any) -> None:
        self._session = session

    async def list_tools(self) -> list[dict[str, Any]]:
        result = await self._session.list_tools()
        # mcp SDK returns ListToolsResult with a .tools attribute
        tools = getattr(result, "tools", result)
        if isinstance(tools, list):
            return [_tool_to_dict(t) for t in tools]
        return []

    async def call_tool(self, tool_name: str, arguments: dict[str, Any], **_: Any) -> Any:
        result = await self._session.call_tool(tool_name, arguments)
        # mcp SDK returns CallToolResult with .content and .isError
        if hasattr(result, "isError") and result.isError:
            error_text = _extract_text(result.content)
            raise RuntimeError(f"MCP tool error: {error_text}")
        return _extract_content(result.content) if hasattr(result, "content") else result

    def __getattr__(self, name: str) -> Any:
        return getattr(self._session, name)


def wrap_mcp_session(
    session: Any,
    watchtower: Any,
    server_name: str,
    server_metadata: dict[str, Any] | None = None,
) -> Any:
    """Wrap an mcp.ClientSession so Watchtower can intercept its tool calls.

    Args:
        session: An initialized mcp.ClientSession.
        watchtower: A Watchtower instance.
        server_name: Label shown in the UI and stored in events.
        server_metadata: Optional dict stored in event metadata (transport, package, etc.).

    Returns:
        A WatchtowerMCPClient wrapping the session.
    """
    bridge = _MCPSessionBridge(session)
    return watchtower.wrap_mcp_client(
        bridge,
        server_name=server_name,
        server_metadata=server_metadata,
    )


def _tool_to_dict(tool: Any) -> dict[str, Any]:
    if isinstance(tool, dict):
        return tool
    return {
        "name": getattr(tool, "name", str(tool)),
        "description": getattr(tool, "description", ""),
        "inputSchema": getattr(tool, "inputSchema", {}),
    }


def _extract_text(content: Any) -> str:
    if isinstance(content, list):
        parts = []
        for item in content:
            text = getattr(item, "text", None) or str(item)
            parts.append(text)
        return " ".join(parts)
    return str(content)


def _extract_content(content: Any) -> Any:
    """Return the most useful Python value from mcp content blocks."""
    if not isinstance(content, list):
        return content
    if len(content) == 1:
        item = content[0]
        # TextContent has .text
        if hasattr(item, "text"):
            return item.text
        return item
    # Multiple content items — return as list of dicts
    result = []
    for item in content:
        if hasattr(item, "text"):
            result.append({"type": "text", "text": item.text})
        elif hasattr(item, "data"):
            result.append({"type": getattr(item, "type", "resource"), "data": item.data})
        else:
            result.append(str(item))
    return result
