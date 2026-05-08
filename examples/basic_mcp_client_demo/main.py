"""Basic MCP-like client integration demo.

This example uses a tiny in-process client with the same methods Watchtower
expects from an MCP client: call_tool(...) and list_tools().
"""

from __future__ import annotations

import asyncio
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from mcp_watchtower import Watchtower


class BasicMCPClient:
    async def list_tools(self) -> dict:
        return {"tools": [{"name": "search_docs"}, {"name": "summarize_doc"}]}

    async def call_tool(self, tool_name: str, arguments: dict) -> dict:
        if tool_name == "search_docs":
            return {"matches": [{"title": "README.md", "score": 0.98}], "query": arguments["query"]}
        raise ValueError(f"unknown tool: {tool_name}")


async def main() -> None:
    db_path = Path(".watchtower/basic_mcp_client_demo.db")
    watchtower = Watchtower("basic-mcp-client-demo", db_path=db_path)
    raw_client = BasicMCPClient()
    client = watchtower.wrap_mcp_client(raw_client, server_name="docs")

    health = await watchtower.check_mcp_server("docs", raw_client, transport="in-process")
    print(f"Health: {health['status']} with {health['tools_count']} tools")

    result = await client.call_tool("search_docs", {"query": "approval policies"})
    print(f"Tool result: {result}")
    print(f"Run ID: {watchtower.run_id}")


if __name__ == "__main__":
    asyncio.run(main())
