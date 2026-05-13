"""
MCP Watchtower — filesystem MCP server example.

Requires:
    pip install mcp-watchtower[dev,server,mcp]
    npm install -g @modelcontextprotocol/server-filesystem   (or use npx)

Run:
    python examples/mcp_sdk_filesystem/main.py

Then open the URL printed to the terminal.
"""

from __future__ import annotations

import asyncio
import os
import tempfile

try:
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client
except ImportError:
    raise SystemExit(
        "The 'mcp' package is required.\n"
        "Install it with: pip install mcp-watchtower[mcp]"
    )

from mcp_watchtower import Watchtower
from mcp_watchtower.adapters import wrap_mcp_session

# Directory the MCP server will expose. Use a temp dir so nothing sensitive is shared.
SERVE_DIR = os.environ.get("WATCHTOWER_FS_DIR", tempfile.gettempdir())


async def main() -> None:
    # Create some demo files in the served directory.
    hello = os.path.join(SERVE_DIR, "hello.txt")
    with open(hello, "w") as fh:
        fh.write("Hello from MCP Watchtower!\n")

    server_params = StdioServerParameters(
        command="npx",
        args=["-y", "@modelcontextprotocol/server-filesystem", SERVE_DIR],
    )

    watchtower = Watchtower(
        app_name="filesystem-example",
        db_path=".watchtower/filesystem_example.db",
        safety=True,
        task=f"Read and list files in {SERVE_DIR}",
        ui=True,
    )

    async with stdio_client(server_params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()

            fs = wrap_mcp_session(
                session,
                watchtower,
                server_name="filesystem",
                server_metadata={"transport": "stdio", "package": "@modelcontextprotocol/server-filesystem"},
            )

            # Health check
            await watchtower.check_mcp_server("filesystem", fs, transport="stdio")

            # List the directory
            entries = await fs.call_tool("list_directory", {"path": SERVE_DIR})
            print(f"\nDirectory listing ({SERVE_DIR}):")
            print(entries)

            # Read the demo file (low risk — allowed by default policy)
            content = await fs.call_tool("read_file", {"path": hello})
            print(f"\nFile content:\n{content}")

            # Write a file — this requires approval via the UI
            print("\nWriting output.txt — check the Watchtower UI to approve...")
            try:
                await fs.call_tool(
                    "write_file",
                    {"path": os.path.join(SERVE_DIR, "output.txt"), "content": "Written by Watchtower.\n"},
                )
                print("Write approved and completed.")
            except Exception as exc:
                print(f"Write was rejected or timed out: {exc}")

    print("\nDone. Run `python -m mcp_watchtower.cli ui --db-path .watchtower/filesystem_example.db` to review the audit trail.")


if __name__ == "__main__":
    asyncio.run(main())
