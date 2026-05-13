"""Main Watchtower entrypoint."""

from __future__ import annotations

import socket
import threading
from pathlib import Path
from typing import Any

from .bus import EventBus
from .emitter import EventEmitter
from .health import HealthChecker
from .mcp_wrapper import WatchtowerMCPClient
from .redaction import build_redactor
from .safety import SafetyPolicy
from .storage import SQLiteStore


def _find_free_port(preferred: int = 8123) -> int:
    """Return preferred port if free, otherwise any available port."""
    for port in range(preferred, preferred + 20):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    # Last resort: let OS pick
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _start_ui_server(db_path: Path, port: int) -> None:
    """Start uvicorn in a daemon thread so it dies when the main process exits."""
    try:
        import uvicorn
        from .server import WatchtowerRuntime, create_app
    except ImportError:
        print(
            "Watchtower UI requires server dependencies.\n"
            'Install with: pip install mcp-watchtower[server]'
        )
        return

    ui_runtime = WatchtowerRuntime(db_path)
    app = create_app(ui_runtime)

    config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning")
    server = uvicorn.Server(config)

    thread = threading.Thread(target=server.run, daemon=True, name="watchtower-ui")
    thread.start()


class Watchtower:
    def __init__(
        self,
        app_name: str,
        ui: bool = False,
        ui_port: int = 8123,
        db_path: str | Path | None = None,
        health_checks: bool = True,
        safety: bool = False,
        policy_path: str | Path | None = None,
        server_metadata: dict[str, dict[str, Any]] | None = None,
        task: str | None = None,
        redact_fields: list[str] | None = None,
        redact_pattern: str | None = None,
    ) -> None:
        self.app_name = app_name
        self.health_checks = health_checks
        self.safety = safety
        self.store = SQLiteStore(db_path)
        self.bus = EventBus()
        self.run = self.store.create_run(app_name=app_name, task=task)
        self.run_id = self.run["run_id"]
        redactor = build_redactor(redact_fields, redact_pattern)
        self.emitter = EventEmitter(self.run_id, self.store, self.bus, redactor=redactor)
        self.policy_path = policy_path
        self.server_metadata = server_metadata or {}
        self.safety_policy = self._load_safety_policy(safety, policy_path)
        self.health_checker = HealthChecker(self.store, self.emitter)

        if ui:
            port = _find_free_port(ui_port)
            _start_ui_server(self.store.db_path, port)
            print(
                f"Watchtower UI: http://127.0.0.1:{port}/  "
                f"(run: {self.run_id})"
            )

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
