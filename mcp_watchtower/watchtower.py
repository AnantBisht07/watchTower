"""Main Watchtower entrypoint."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .bus import EventBus
from .emitter import EventEmitter
from .health import HealthChecker
from .mcp_wrapper import WatchtowerMCPClient
from .safety import SafetyPolicy
from .storage import SQLiteStore


class Watchtower:
    def __init__(
        self,
        app_name: str,
        ui: bool = True,
        db_path: str | Path | None = None,
        health_checks: bool = True,
        safety: bool = False,
        policy_path: str | Path | None = None,
        server_metadata: dict[str, dict[str, Any]] | None = None,
        task: str | None = None,
    ) -> None:
        self.app_name = app_name
        self.ui = ui
        self.health_checks = health_checks
        self.safety = safety
        self.store = SQLiteStore(db_path)
        self.bus = EventBus()
        self.run = self.store.create_run(app_name=app_name, task=task)
        self.run_id = self.run["run_id"]
        self.emitter = EventEmitter(self.run_id, self.store, self.bus)
        self.policy_path = policy_path
        self.server_metadata = server_metadata or {}
        self.safety_policy = self._load_safety_policy(safety, policy_path)
        self.health_checker = HealthChecker(self.store, self.emitter)

    async def emit(self, event: dict[str, Any]) -> dict[str, Any]:
        return await self.emitter.emit(event)

    def wrap_mcp_client(
        self,
        client: Any,
        server_name: str | None = None,
        server_metadata: dict[str, Any] | None = None,
    ) -> WatchtowerMCPClient:
        metadata = server_metadata or self.server_metadata.get(server_name or "")
        return WatchtowerMCPClient(
            client,
            self.emitter,
            server_name=server_name,
            server_metadata=metadata,
            safety_policy=self.safety_policy,
        )

    async def check_mcp_server(
        self,
        server_name: str,
        client: Any,
        transport: str | None = None,
        timeout_s: float | None = None,
        server_metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return await self.health_checker.check_client(
            server=server_name,
            client=client,
            transport=transport,
            timeout_s=timeout_s,
            server_metadata=server_metadata or self.server_metadata.get(server_name),
        )

    def _load_safety_policy(
        self, safety: bool, policy_path: str | Path | None
    ) -> SafetyPolicy | None:
        if policy_path is not None:
            return SafetyPolicy.from_file(policy_path)
        if safety:
            return SafetyPolicy()
        return None
