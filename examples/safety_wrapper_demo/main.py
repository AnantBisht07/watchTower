"""Minimal safety-gated MCP wrapper demo.

This example simulates an MCP client with a state-changing write tool. Watchtower
emits an approval request and waits until a decision is persisted.
"""

from __future__ import annotations

import asyncio
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from mcp_watchtower import Watchtower


class FakeFilesystemMCPClient:
    async def call_tool(self, tool_name: str, arguments: dict) -> dict:
        return {"tool": tool_name, "path": arguments["path"], "written": True}


async def main() -> None:
    db_path = Path(".watchtower/safety_wrapper_demo.db")
    watchtower = Watchtower("safety-wrapper-demo", db_path=db_path, safety=True)
    client = watchtower.wrap_mcp_client(FakeFilesystemMCPClient(), server_name="filesystem")

    task = asyncio.create_task(client.call_tool("write_file", {"path": "summary.md"}))

    approval = await wait_for_approval(watchtower)
    print(f"Approval requested: {approval['approval_id']}")

    watchtower.store.decide_approval(approval["approval_id"], "approved")
    result = await task
    print(f"Tool result: {result}")


async def wait_for_approval(watchtower: Watchtower) -> dict:
    for _ in range(100):
        approvals = watchtower.store.list_approvals(run_id=watchtower.run_id)
        if approvals:
            return approvals[0]
        await asyncio.sleep(0.05)
    raise TimeoutError("approval was not created")


if __name__ == "__main__":
    asyncio.run(main())
