"""Real use-case smoke: approval-gated repo audit report.

This script simulates an agent that audits this repository using a small
filesystem MCP-like client. It reads project files, prepares a report, pauses
before writing it, approves the write, and verifies the recorded Watchtower
events and output file.
"""

from __future__ import annotations

import asyncio
from pathlib import Path
import sys
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from mcp_watchtower import Watchtower


class RepoFilesystemClient:
    def __init__(self, root: Path, output_dir: Path) -> None:
        self.root = root.resolve()
        self.output_dir = output_dir.resolve()

    async def list_tools(self) -> dict[str, list[dict[str, str]]]:
        return {
            "tools": [
                {"name": "read_file"},
                {"name": "write_file"},
            ]
        }

    async def call_tool(self, tool_name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        if tool_name == "read_file":
            path = self._repo_path(arguments["path"])
            return {"path": str(path.relative_to(self.root)), "content": path.read_text()}

        if tool_name == "write_file":
            path = self._output_path(arguments["path"])
            path.write_text(arguments["content"])
            return {"path": str(path), "bytes": path.stat().st_size}

        raise ValueError(f"unknown tool: {tool_name}")

    def _repo_path(self, relative_path: str) -> Path:
        path = (self.root / relative_path).resolve()
        if not path.is_relative_to(self.root):
            raise PermissionError(f"path escapes repository: {relative_path}")
        return path

    def _output_path(self, filename: str) -> Path:
        path = (self.output_dir / filename).resolve()
        if not path.is_relative_to(self.output_dir):
            raise PermissionError(f"path escapes output directory: {filename}")
        return path


async def main() -> None:
    output_dir = ROOT / ".watchtower" / "use_case_repo_audit"
    output_dir.mkdir(parents=True, exist_ok=True)
    db_path = output_dir / "watchtower.db"
    report_path = output_dir / "repo_audit_report.md"

    watchtower = Watchtower("repo-audit-agent", db_path=db_path, safety=True)
    try:
        raw_client = RepoFilesystemClient(ROOT, output_dir)
        client = watchtower.wrap_mcp_client(raw_client, server_name="filesystem")

        health = await watchtower.check_mcp_server("filesystem", raw_client, transport="local")
        assert health["status"] == "healthy"
        assert health["tools_count"] == 2

        readme = await client.call_tool("read_file", {"path": "README.md"})
        pyproject = await client.call_tool("read_file", {"path": "pyproject.toml"})
        report = build_report(readme["content"], pyproject["content"])

        write_task = asyncio.create_task(
            client.call_tool(
                "write_file",
                {
                    "path": report_path.name,
                    "content": report,
                },
            )
        )
        approval = await wait_for_approval(watchtower)
        assert approval["status"] == "waiting"
        watchtower.store.decide_approval(approval["approval_id"], "approved")

        write_result = await write_task
        assert Path(write_result["path"]).read_text() == report

        events = watchtower.store.list_events(watchtower.run_id)
        event_types = [event["type"] for event in events]
        assert event_types.count("tool_call_completed") == 3
        assert "approval_required" in event_types
        assert "tool_call_approved" in event_types
        assert report_path.exists()

        print("Real use-case passed")
        print(f"Run ID: {watchtower.run_id}")
        print(f"Report: {report_path}")
        print(f"Events: {len(events)}")
        print(f"Approval: {approval['approval_id']}")
    finally:
        watchtower.store.close()


def build_report(readme: str, pyproject: str) -> str:
    package_line = next(
        (line for line in pyproject.splitlines() if line.startswith("name = ")),
        "name = unknown",
    )
    return "\n".join(
        [
            "# Repo Audit Report",
            "",
            f"- Package: {package_line.removeprefix('name = ').strip().strip(chr(34))}",
            f"- README length: {len(readme)} characters",
            "- Watchtower path: filesystem reads are allowed, report write requires approval.",
            "",
        ]
    )


async def wait_for_approval(watchtower: Watchtower) -> dict[str, Any]:
    for _ in range(100):
        approvals = watchtower.store.list_approvals(run_id=watchtower.run_id)
        if approvals:
            return approvals[0]
        await asyncio.sleep(0.05)
    raise TimeoutError("approval was not created")


if __name__ == "__main__":
    asyncio.run(main())
