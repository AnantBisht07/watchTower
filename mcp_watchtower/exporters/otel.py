"""OpenTelemetry exporter for Watchtower events.

Install:
    pip install mcp-watchtower[otel]

Usage:
    from mcp_watchtower.exporters.otel import OTelExporter
    from mcp_watchtower import Watchtower

    exporter = OTelExporter(service_name="my-agent")

    watchtower = Watchtower(app_name="my-agent")
    watchtower.add_exporter(exporter)
"""

from __future__ import annotations

from typing import Any


class OTelExporter:
    """Maps Watchtower events to OpenTelemetry spans.

    Requires: opentelemetry-sdk opentelemetry-exporter-otlp-proto-grpc
    """

    def __init__(
        self,
        service_name: str = "mcp-watchtower",
        endpoint: str = "http://localhost:4317",
    ) -> None:
        self.service_name = service_name
        self.endpoint = endpoint
        self._tracer = self._init_tracer()
        # span_id -> OTel span (kept open until terminal event)
        self._spans: dict[str, Any] = {}

    def _init_tracer(self) -> Any:
        try:
            from opentelemetry import trace
            from opentelemetry.sdk.resources import SERVICE_NAME, Resource
            from opentelemetry.sdk.trace import TracerProvider
            from opentelemetry.sdk.trace.export import BatchSpanProcessor
            from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
        except ImportError:
            raise ImportError(
                "OpenTelemetry dependencies are missing.\n"
                "Install with: pip install mcp-watchtower[otel]"
            )
        resource = Resource(attributes={SERVICE_NAME: self.service_name})
        provider = TracerProvider(resource=resource)
        exporter = OTLPSpanExporter(endpoint=self.endpoint)
        provider.add_span_processor(BatchSpanProcessor(exporter))
        trace.set_tracer_provider(provider)
        return trace.get_tracer(self.service_name)

    def on_event(self, event: dict[str, Any]) -> None:
        event_type = event.get("type", "")
        event_id = event.get("event_id", "")
        parent_id = event.get("parent_event_id")

        if event_type == "tool_call_started":
            ctx = self._spans.get(parent_id) if parent_id else None
            from opentelemetry.trace import NonRecordingSpan, use_span
            span = self._tracer.start_span(
                name=f"{event.get('server', 'unknown')}.{event.get('tool', 'unknown')}",
                context=ctx,
                attributes={
                    "mcp.server": event.get("server") or "",
                    "mcp.tool": event.get("tool") or "",
                    "mcp.run_id": event.get("run_id") or "",
                    "mcp.risk": event.get("risk") or "low",
                },
            )
            self._spans[event_id] = span

        elif event_type in {"tool_call_completed", "tool_call_failed", "tool_call_timeout"}:
            # Find the matching started span via parent_event_id
            span = self._spans.pop(parent_id or event_id, None)
            if span is None:
                return
            from opentelemetry.trace import StatusCode
            if event_type == "tool_call_completed":
                span.set_status(StatusCode.OK)
                latency = event.get("latency_ms")
                if latency is not None:
                    span.set_attribute("mcp.latency_ms", latency)
            else:
                span.set_status(StatusCode.ERROR, description=str(event.get("error", "")))
            span.end()

        elif event_type == "approval_required":
            span = self._spans.get(parent_id) if parent_id else None
            if span:
                span.add_event(
                    "approval_required",
                    attributes={"mcp.risk": event.get("risk") or "", "mcp.reason": event.get("reason") or ""},
                )

        elif event_type in {"tool_call_approved", "tool_call_rejected"}:
            span = self._spans.get(parent_id) if parent_id else None
            if span:
                span.add_event(event_type, attributes={"mcp.approval_id": event.get("approval_id") or ""})
