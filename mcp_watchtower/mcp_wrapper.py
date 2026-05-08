"""MCP client wrapper that emits tool-call lifecycle events."""

from __future__ import annotations

import asyncio
import inspect
from time import perf_counter
from typing import Any

from .emitter import EventEmitter
from .events import new_id, summarize_output
from .safety import RiskDecision, SafetyPolicy


class ToolRejectedError(PermissionError):
    """Raised when Watchtower blocks or rejects a tool call."""


class ApprovalTimeoutError(TimeoutError):
    """Raised when a tool call waits too long for approval."""


class WatchtowerMCPClient:
    def __init__(
        self,
        client: Any,
        emitter: EventEmitter,
        server_name: str | None = None,
        server_metadata: dict[str, Any] | None = None,
        safety_policy: SafetyPolicy | None = None,
        approval_timeout_s: float = 300,
        approval_poll_interval_s: float = 0.25,
    ) -> None:
        self._client = client
        self._emitter = emitter
        self._server_name = server_name
        self._server_metadata = server_metadata or {}
        self._safety_policy = safety_policy
        self._approval_timeout_s = approval_timeout_s
        self._approval_poll_interval_s = approval_poll_interval_s

    def __getattr__(self, name: str) -> Any:
        return getattr(self._client, name)

    async def call_tool(self, tool_name: str, arguments: dict[str, Any] | None = None, **kwargs: Any) -> Any:
        arguments = arguments or {}
        risk_decision = self._classify(tool_name, arguments)
        requested = await self._emitter.emit(
            {
                "type": "tool_call_requested",
                "status": "pending",
                "server": self._server_name,
                "tool": tool_name,
                "risk": risk_decision.risk,
                "input": arguments,
                "message": f"Agent requested {self._display_tool(tool_name)}",
                "metadata": self._metadata(safety_action=risk_decision.action),
            }
        )
        await self._enforce_safety(requested, tool_name, arguments, risk_decision)
        await self._emitter.emit(
            {
                "type": "tool_call_started",
                "status": "running",
                "parent_event_id": requested["event_id"],
                "server": self._server_name,
                "tool": tool_name,
                "message": f"Calling {self._display_tool(tool_name)}",
                "metadata": self._metadata(),
            }
        )

        start = perf_counter()
        try:
            result = await self._call_underlying_tool(tool_name, arguments, **kwargs)
        except TimeoutError as exc:
            latency_ms = int((perf_counter() - start) * 1000)
            await self._emitter.emit(
                {
                    "type": "tool_call_timeout",
                    "status": "failed",
                    "parent_event_id": requested["event_id"],
                    "server": self._server_name,
                    "tool": tool_name,
                    "latency_ms": latency_ms,
                    "message": f"{self._display_tool(tool_name)} timed out",
                    "error": {"code": "TIMEOUT", "detail": str(exc)},
                    "metadata": self._metadata(),
                }
            )
            raise
        except Exception as exc:
            latency_ms = int((perf_counter() - start) * 1000)
            await self._emitter.emit(
                {
                    "type": "tool_call_failed",
                    "status": "failed",
                    "parent_event_id": requested["event_id"],
                    "server": self._server_name,
                    "tool": tool_name,
                    "latency_ms": latency_ms,
                    "message": f"{self._display_tool(tool_name)} failed",
                    "error": {"code": exc.__class__.__name__, "detail": str(exc)},
                    "metadata": self._metadata(),
                }
            )
            raise

        latency_ms = int((perf_counter() - start) * 1000)
        await self._emitter.emit(
            {
                "type": "tool_call_completed",
                "status": "completed",
                "parent_event_id": requested["event_id"],
                "server": self._server_name,
                "tool": tool_name,
                "latency_ms": latency_ms,
                "message": f"{self._display_tool(tool_name)} completed",
                "output_summary": summarize_output(result),
                "metadata": self._metadata(),
            }
        )
        return result

    async def _call_underlying_tool(
        self, tool_name: str, arguments: dict[str, Any], **kwargs: Any
    ) -> Any:
        call_tool = self._client.call_tool
        try:
            result = call_tool(tool_name, arguments, **kwargs)
        except TypeError as positional_error:
            try:
                result = call_tool(name=tool_name, arguments=arguments, **kwargs)
            except TypeError:
                raise positional_error

        if inspect.isawaitable(result):
            return await result
        return result

    def _classify(self, tool_name: str, arguments: dict[str, Any]) -> RiskDecision:
        if self._safety_policy is None:
            return RiskDecision("allow", "low", "Safety policy is disabled.")
        return self._safety_policy.classify_tool(self._server_name, tool_name, arguments)

    async def _enforce_safety(
        self,
        requested_event: dict[str, Any],
        tool_name: str,
        arguments: dict[str, Any],
        decision: RiskDecision,
    ) -> None:
        if decision.action == "allow":
            return

        if decision.action == "block":
            await self._emitter.emit(
                {
                    "type": "tool_call_rejected",
                    "status": "rejected",
                    "parent_event_id": requested_event["event_id"],
                    "server": self._server_name,
                    "tool": tool_name,
                    "risk": decision.risk,
                    "message": f"Blocked {self._display_tool(tool_name)}",
                    "reason": decision.reason,
                    "error": {"code": "POLICY_BLOCKED", "detail": decision.reason},
                    "metadata": self._metadata(safety_action=decision.action),
                }
            )
            raise ToolRejectedError(decision.reason)

        if decision.action != "require_approval":
            raise ValueError(f"unknown safety action: {decision.action}")

        approval_id = new_id("apv")
        await self._emitter.emit(
            {
                "type": "approval_required",
                "status": "waiting",
                "parent_event_id": requested_event["event_id"],
                "server": self._server_name,
                "tool": tool_name,
                "risk": decision.risk,
                "approval_id": approval_id,
                "message": f"Approval required before {self._display_tool(tool_name)}",
                "reason": decision.reason,
                "input": arguments,
                "metadata": self._metadata(safety_action=decision.action),
            }
        )

        approval = await self._wait_for_approval(approval_id)
        if approval["status"] == "approved":
            await self._emitter.emit(
                {
                    "type": "tool_call_approved",
                    "status": "completed",
                    "parent_event_id": requested_event["event_id"],
                    "server": self._server_name,
                    "tool": tool_name,
                    "risk": decision.risk,
                    "approval_id": approval_id,
                    "message": f"Approved {self._display_tool(tool_name)}",
                    "metadata": self._metadata(decision="approved", safety_action=decision.action),
                }
            )
            return

        await self._emitter.emit(
            {
                "type": "tool_call_rejected",
                "status": "rejected",
                "parent_event_id": requested_event["event_id"],
                "server": self._server_name,
                "tool": tool_name,
                "risk": decision.risk,
                "approval_id": approval_id,
                "message": f"Rejected {self._display_tool(tool_name)}",
                "metadata": self._metadata(decision="rejected", safety_action=decision.action),
            }
        )
        raise ToolRejectedError(f"Tool call rejected: {self._display_tool(tool_name)}")

    async def _wait_for_approval(self, approval_id: str) -> dict[str, Any]:
        deadline = perf_counter() + self._approval_timeout_s
        while perf_counter() < deadline:
            approval = self._emitter.store.get_approval(approval_id)
            if approval and approval["status"] in {"approved", "rejected"}:
                return approval
            await asyncio.sleep(self._approval_poll_interval_s)

        await self._emitter.emit(
            {
                "type": "tool_call_rejected",
                "status": "failed",
                "approval_id": approval_id,
                "message": "Approval timed out",
                "error": {
                    "code": "APPROVAL_TIMEOUT",
                    "detail": f"No decision after {self._approval_timeout_s} seconds.",
                },
                "metadata": self._metadata(safety_action="require_approval"),
            }
        )
        raise ApprovalTimeoutError(f"approval timed out: {approval_id}")

    def _display_tool(self, tool_name: str) -> str:
        return f"{self._server_name}.{tool_name}" if self._server_name else tool_name

    def _metadata(self, **extra: Any) -> dict[str, Any]:
        metadata = {"source": "mcp_client_wrapper"}
        if self._server_metadata:
            metadata["server_metadata"] = self._server_metadata
        metadata.update({key: value for key, value in extra.items() if value is not None})
        return metadata
