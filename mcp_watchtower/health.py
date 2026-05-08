"""MCP service health models and helpers."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
import inspect
from time import perf_counter
from typing import Any

from .events import utc_now_iso
from .emitter import EventEmitter
from .storage import SQLiteStore


@dataclass(slots=True)
class HealthStatus:
    server: str
    status: str
    tools_count: int = 0
    latency_ms: int | None = None
    last_error: str | None = None
    run_id: str | None = None
    last_checked_at: str = ""

    def to_dict(self) -> dict[str, object]:
        return {
            "server": self.server,
            "status": self.status,
            "tools_count": self.tools_count,
            "latency_ms": self.latency_ms,
            "last_error": self.last_error,
            "run_id": self.run_id,
            "last_checked_at": self.last_checked_at or utc_now_iso(),
        }


def fake_health(run_id: str) -> list[dict[str, object]]:
    return [
        HealthStatus("filesystem", "healthy", tools_count=6, latency_ms=31, run_id=run_id).to_dict(),
        HealthStatus("github", "healthy", tools_count=18, latency_ms=140, run_id=run_id).to_dict(),
        HealthStatus(
            "browser",
            "timeout",
            tools_count=0,
            latency_ms=5000,
            last_error="MCP server did not respond within 5 seconds",
            run_id=run_id,
        ).to_dict(),
    ]


class HealthChecker:
    """Checks whether an MCP-like client can list tools."""

    def __init__(
        self,
        store: SQLiteStore,
        emitter: EventEmitter | None = None,
        timeout_s: float = 5,
    ) -> None:
        self.store = store
        self.emitter = emitter
        self.timeout_s = timeout_s

    async def check_client(
        self,
        server: str,
        client: Any,
        transport: str | None = None,
        timeout_s: float | None = None,
        server_metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        timeout = timeout_s or self.timeout_s
        run_id = self.emitter.run_id if self.emitter else None
        if self.emitter:
            await self.emitter.emit(
                {
                    "type": "health_check_started",
                    "status": "running",
                    "server": server,
                    "transport": transport,
                    "message": f"Checking {server} MCP service",
                    "metadata": {"server_metadata": server_metadata}
                    if server_metadata
                    else {},
                }
            )

        start = perf_counter()
        try:
            tools = await asyncio.wait_for(self._list_tools(client), timeout=timeout)
            latency_ms = int((perf_counter() - start) * 1000)
            health = HealthStatus(
                server=server,
                status="healthy",
                tools_count=count_tools(tools),
                latency_ms=latency_ms,
                run_id=run_id,
            ).to_dict()
            self.store.upsert_server_health(health)
            if self.emitter:
                await self.emitter.emit(
                    {
                        "type": "health_check_completed",
                        "status": "completed",
                        "server": server,
                        "transport": transport,
                        "latency_ms": latency_ms,
                        "message": f"{server} MCP service is healthy",
                        "metadata": _with_server_metadata(health, server_metadata),
                    }
                )
            return health
        except asyncio.TimeoutError:
            latency_ms = int((perf_counter() - start) * 1000)
            return await self._record_failure(
                server=server,
                status="timeout",
                latency_ms=latency_ms,
                error=f"MCP service did not respond within {timeout:g} seconds",
                transport=transport,
                server_metadata=server_metadata,
            )
        except Exception as exc:
            latency_ms = int((perf_counter() - start) * 1000)
            message = str(exc) or exc.__class__.__name__
            status = "auth_failed" if "auth" in message.lower() else "unhealthy"
            return await self._record_failure(
                server=server,
                status=status,
                latency_ms=latency_ms,
                error=message,
                transport=transport,
                server_metadata=server_metadata,
            )

    async def _record_failure(
        self,
        server: str,
        status: str,
        latency_ms: int,
        error: str,
        transport: str | None = None,
        server_metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        run_id = self.emitter.run_id if self.emitter else None
        health = HealthStatus(
            server=server,
            status=status,
            tools_count=0,
            latency_ms=latency_ms,
            last_error=error,
            run_id=run_id,
        ).to_dict()
        self.store.upsert_server_health(health)
        if self.emitter:
            await self.emitter.emit(
                {
                    "type": "health_check_failed",
                    "status": "failed",
                    "server": server,
                    "transport": transport,
                    "latency_ms": latency_ms,
                    "message": f"{server} MCP service health check failed",
                    "error": {"code": status.upper(), "detail": error},
                    "metadata": _with_server_metadata(health, server_metadata),
                }
            )
        return health

    async def _list_tools(self, client: Any) -> Any:
        if not hasattr(client, "list_tools"):
            raise AttributeError("client does not expose list_tools")
        result = client.list_tools()
        if inspect.isawaitable(result):
            return await result
        return result


def count_tools(tools: Any) -> int:
    if tools is None:
        return 0
    if isinstance(tools, dict):
        nested_tools = tools.get("tools")
        if nested_tools is not None:
            return count_tools(nested_tools)
        return len(tools)
    if isinstance(tools, (list, tuple, set)):
        return len(tools)
    nested_tools = getattr(tools, "tools", None)
    if nested_tools is not None:
        return count_tools(nested_tools)
    try:
        return len(tools)
    except TypeError:
        return 1


def _with_server_metadata(
    health: dict[str, Any], server_metadata: dict[str, Any] | None
) -> dict[str, Any]:
    if not server_metadata:
        return health
    enriched = dict(health)
    enriched["server_metadata"] = server_metadata
    return enriched
