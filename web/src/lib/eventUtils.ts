import type {
  Health,
  PrimaryToolCall,
  RouteNode,
  Run,
  RunMode,
  TimelineItem,
  Tone,
  WatchtowerEvent
} from "../types";

export const eventTypes = [
  "run_started",
  "run_completed",
  "run_failed",
  "agent_step_started",
  "agent_step_completed",
  "agent_failed",
  "mcp_server_check_started",
  "mcp_server_connected",
  "mcp_server_failed",
  "health_check_started",
  "health_check_completed",
  "health_check_failed",
  "tool_discovered",
  "tools_discovered",
  "tool_call_requested",
  "tool_call_auto_approved",
  "tool_call_approval_required",
  "tool_call_started",
  "tool_call_completed",
  "tool_call_failed",
  "tool_call_timeout",
  "approval_required",
  "tool_call_approved",
  "tool_call_rejected"
];

export function getRunMode(run: Run | null, events: WatchtowerEvent[]): RunMode {
  if (!run) return "idle";

  const latestRejection = [...events].reverse().find((event) => event.type === "tool_call_rejected");
  if (latestRejection) {
    return isPolicyBlock(latestRejection) ? "blocked" : "rejected";
  }

  if (getPendingApproval(events, run)) return "waiting_for_approval";

  if (run.status === "failed" || events.some((event) => event.type === "run_failed" || event.type === "agent_failed")) {
    return "failed";
  }

  if (run.status === "completed" || events.some((event) => event.type === "run_completed")) {
    return "completed";
  }

  return "running";
}

export function getPendingApproval(events: WatchtowerEvent[], run?: Run | null) {
  if (run?.status === "completed" || run?.status === "failed") return undefined;
  if (events.some((event) => event.type === "run_completed" || event.type === "run_failed")) return undefined;

  const decided = new Set(
    events
      .filter((event) => event.type === "tool_call_approved" || event.type === "tool_call_rejected")
      .map((event) => event.approval_id)
      .filter((value): value is string => Boolean(value))
  );

  return [...events]
    .reverse()
    .find((event) => isApprovalRequiredEvent(event) && (!event.approval_id || !decided.has(event.approval_id)));
}

export function getPrimaryToolCall(run: Run | null, events: WatchtowerEvent[]): PrimaryToolCall {
  const approval = getPendingApproval(events, run) ?? getFirstApprovalGate(events);
  const requested =
    approval ??
    events.find((event) => event.type === "tool_call_requested" && isRisky(event)) ??
    [...events].reverse().find((event) => Boolean(event.tool || event.server));

  const event = requested;
  const server = event?.server ?? "MCP server";
  const tool = event?.tool ?? "tool";
  const fullName = event?.server && event?.tool ? `${event.server}.${event.tool}` : tool;
  const approved = approval ? getApprovalDecision(events, approval, "approved") : undefined;
  const rejected = approval ? getApprovalDecision(events, approval, "rejected") : undefined;
  const hasExecuted = Boolean(
    event?.server &&
      event?.tool &&
      events.some(
        (candidate) =>
          (candidate.type === "tool_call_started" || candidate.type === "tool_call_completed") &&
          candidate.server === event.server &&
          candidate.tool === event.tool
      )
  );

  return {
    server,
    tool,
    fullName,
    target: event ? targetLabel(event) : "selected target",
    risk: event?.risk ?? "unknown",
    reason: normalizeReason(event?.reason),
    action: event ? actionPhrase(event) : "call a tool",
    hasExecuted,
    decision: getPendingApproval(events, run)
      ? "waiting"
      : rejected
        ? isPolicyBlock(rejected)
          ? "blocked"
          : "rejected"
        : approved
          ? "approved"
          : null,
    event
  };
}

export function getCurrentToolEvent(events: WatchtowerEvent[]) {
  return [...events]
    .reverse()
    .find(
      (event) =>
        event.type.startsWith("tool_call") ||
        event.type === "approval_required" ||
        event.type === "tool_call_approval_required"
    );
}

export function getRouteNodes(run: Run | null, events: WatchtowerEvent[]): RouteNode[] {
  const mode = getRunMode(run, events);
  const started = Boolean(run || events.some((event) => event.type === "run_started"));
  const agentActive = events.some((event) => event.type.startsWith("agent_"));
  const checked = events.some(isHealthEvent);
  const requested = events.some((event) => event.type === "tool_call_requested" || event.type === "tool_call_auto_approved");
  const approval = getFirstApprovalGate(events);
  const pendingApproval = getPendingApproval(events, run);
  const approved = approval ? getApprovalDecision(events, approval, "approved") : undefined;
  const rejected = events.find((event) => event.type === "tool_call_rejected");
  const forwarded = events.some((event) => event.type === "tool_call_started");
  const toolCompleted = events.some((event) => event.type === "tool_call_completed");
  const toolFailed = events.some((event) => event.type === "tool_call_failed" || event.type === "tool_call_timeout");
  const runCompleted = mode === "completed";
  const terminalFailure = mode === "failed" || mode === "rejected" || mode === "blocked";

  return [
    {
      key: "task",
      label: "User Task",
      detail: run?.task ?? "Waiting for a run",
      status: started ? "completed" : "future"
    },
    {
      key: "agent",
      label: "Agent",
      detail: requested ? "Requested MCP tool" : agentActive ? "Preparing tool call" : "Ready",
      status: !started ? "future" : requested || terminalFailure || runCompleted ? "completed" : "current"
    },
    {
      key: "watchtower",
      label: "Watchtower",
      detail: requested ? "Intercepted request" : checked ? "Checking MCP path" : "Standing by",
      status: !started ? "future" : requested || approval || runCompleted ? "completed" : "current",
      badge: requested || approval ? "intercept" : undefined
    },
    {
      key: "policy",
      label: "Policy Check",
      detail: approval ? "Approval required" : requested ? "Cleared request" : "Awaiting request",
      status: approval && pendingApproval ? "warning" : terminalFailure ? "failed" : requested || approval ? "completed" : "future",
      badge: approval ? "risk detected" : undefined
    },
    {
      key: "approval",
      label: "Approval Gate",
      detail: pendingApproval
        ? "MCP call paused"
        : approved
          ? "Approved by human"
          : rejected
            ? isPolicyBlock(rejected)
              ? "Blocked by policy"
              : "Rejected by human"
            : requested
              ? "No gate needed"
              : "Future",
      status: pendingApproval ? "warning" : rejected ? "blocked" : approved || (requested && !approval) ? "completed" : "future",
      badge: pendingApproval ? "human review" : approved ? "approved" : rejected ? "blocked" : undefined
    },
    {
      key: "mcp",
      label: "MCP Server",
      detail: toolCompleted ? "Tool returned result" : forwarded ? "Executing tool" : rejected ? "Not forwarded" : "Awaiting clearance",
      status: toolFailed ? "failed" : rejected ? "blocked" : toolCompleted ? "completed" : forwarded ? "current" : "future"
    },
    {
      key: "result",
      label: "Tool Result",
      detail: toolCompleted ? "Completed" : toolFailed ? "Failed" : rejected ? "Blocked" : runCompleted ? "Recorded" : "Pending",
      status: toolFailed || mode === "failed" ? "failed" : rejected ? "blocked" : runCompleted || toolCompleted ? "completed" : "future"
    }
  ];
}

export function getTimelineItem(event: WatchtowerEvent, events: WatchtowerEvent[]): TimelineItem {
  if (event.type === "run_started") {
    return item(event, "Run opened", "Agent received the task.", "active");
  }

  if (event.type === "agent_step_started") {
    return item(event, "Agent preparing tool", "Agent moved toward an MCP tool call.", "active");
  }

  if (event.type === "agent_step_completed") {
    return item(event, "Agent received result", "Tool output returned to the agent.", "success");
  }

  if (event.type === "health_check_started" || event.type === "mcp_server_check_started") {
    return item(event, "Server health check", `${event.server ?? "MCP server"} check started.`, "active");
  }

  if (event.type === "health_check_completed" || event.type === "mcp_server_connected") {
    return item(event, "Server healthy", `${event.server ?? "MCP server"} is reachable.`, "success");
  }

  if (event.type === "health_check_failed" || event.type === "mcp_server_failed") {
    return item(event, "Server unhealthy", `${event.server ?? "MCP server"} failed health check.`, "danger", "attention", true);
  }

  if (event.type === "tool_discovered" || event.type === "tools_discovered") {
    const count = numberValue(event.metadata?.tools_count ?? event.metadata?.toolsCount);
    return item(
      event,
      "Tools discovered",
      count ? `${event.server ?? "MCP server"} exposed ${count} tools.` : `${event.server ?? "MCP server"} exposed tools.`,
      "success"
    );
  }

  if (event.type === "tool_call_requested" || event.type === "tool_call_auto_approved") {
    return item(
      event,
      "Agent requested tool",
      `${formatToolName(event)} requested${event.risk ? ` with ${event.risk} risk` : ""}.`,
      isRisky(event) ? "warning" : "active",
      isRisky(event) ? "risk" : undefined,
      isRisky(event)
    );
  }

  if (isApprovalRequiredEvent(event)) {
    return item(
      event,
      "Policy requires approval",
      `Watchtower paused ${formatToolName(event)} before MCP execution.`,
      "warning",
      "approval gate",
      true
    );
  }

  if (event.type === "tool_call_approved") {
    return item(event, "Approved and forwarded", "Human approval released the MCP call.", "success", "approved", true);
  }

  if (event.type === "tool_call_rejected") {
    return item(
      event,
      isPolicyBlock(event) ? "Policy blocked tool" : "Rejected and blocked",
      `${formatToolName(event)} was not forwarded to MCP.`,
      "danger",
      "blocked",
      true
    );
  }

  if (event.type === "tool_call_started") {
    const gated = events.some((candidate) => isApprovalRequiredEvent(candidate) && sameTool(candidate, event));
    return item(
      event,
      gated ? "Watchtower forwarded call" : "MCP call started",
      `${formatToolName(event)} is executing on ${event.server ?? "the MCP server"}.`,
      "active"
    );
  }

  if (event.type === "tool_call_completed") {
    return item(event, "Tool completed", `${formatToolName(event)} returned successfully.`, "success", "completed");
  }

  if (event.type === "tool_call_failed" || event.type === "tool_call_timeout") {
    return item(event, "Tool failed", `${formatToolName(event)} failed before completion.`, "danger", "failed", true);
  }

  if (event.type === "run_completed") {
    return item(event, "Run completed", "Audit trail closed successfully.", "success", "completed");
  }

  if (event.type === "run_failed" || event.type === "agent_failed") {
    return item(event, "Run stopped", event.message || "The run stopped before completion.", "danger", "failed", true);
  }

  return item(event, readableEventType(event.type), event.message || "Watchtower recorded this event.", getStatusTone(event.status));
}

export function getOutcomeSummary(run: Run | null, events: WatchtowerEvent[], health: Health[]) {
  const riskyActions = events.filter((event) => isApprovalRequiredEvent(event) || isRisky(event)).length;
  const reviewed = events.filter((event) => event.type === "tool_call_approved" || event.type === "tool_call_rejected").length;
  const failed = events.filter(isFailureEvent).length;
  const healthy = health.filter((item) => item.status === "healthy").length;
  const unhealthy = health.length - healthy;
  const latest = events.at(-1);

  return {
    status: run ? getRunMode(run, events) : "idle",
    totalEvents: events.length,
    riskyActions,
    reviewed,
    failed,
    duration: formatDuration(run?.started_at, run?.completed_at ?? latest?.timestamp),
    health: health.length ? `${healthy} healthy${unhealthy ? `, ${unhealthy} attention` : ""}` : "No health checks yet"
  };
}

export function getHealthTone(item: Health): Tone {
  if (item.status === "healthy" && (item.latency_ms ?? 0) < 1000) return "success";
  if (item.status === "healthy") return "warning";
  if (["timeout", "unhealthy", "failed"].includes(item.status)) return "danger";
  return "neutral";
}

export function getStatusTone(status: string): Tone {
  if (["completed", "healthy", "approved", "success"].includes(status)) return "success";
  if (["waiting", "pending", "waiting_for_approval"].includes(status)) return "warning";
  if (["failed", "rejected", "timeout", "blocked", "unhealthy"].includes(status)) return "danger";
  if (status === "running") return "active";
  return "neutral";
}

export function getRiskTone(risk?: string): Tone {
  if (risk === "low") return "success";
  if (risk === "medium") return "warning";
  if (risk === "high" || risk === "critical") return "danger";
  return "neutral";
}

export function isApprovalRequiredEvent(event: WatchtowerEvent) {
  return event.type === "approval_required" || event.type === "tool_call_approval_required";
}

export function isHealthEvent(event: WatchtowerEvent) {
  return (
    event.type.startsWith("health_check") ||
    event.type === "mcp_server_check_started" ||
    event.type === "mcp_server_connected" ||
    event.type === "mcp_server_failed"
  );
}

export function isFailureEvent(event: WatchtowerEvent) {
  return (
    event.type === "tool_call_failed" ||
    event.type === "tool_call_timeout" ||
    event.type === "health_check_failed" ||
    event.type === "mcp_server_failed" ||
    event.type === "run_failed" ||
    event.type === "agent_failed"
  );
}

export function runScenario(run: Run) {
  if (run.app_name === "fake-agent-demo") {
    return "Journey Demo";
  }
  if (run.app_name === "safety-gate-demo") {
    return "Safety Demo";
  }
  if (run.app_name === "toy-mcp-real-test") {
    return "MCP Server Test";
  }
  return run.app_name;
}

export function formatToolName(event: WatchtowerEvent | PrimaryToolCall | undefined) {
  if (!event) return "MCP tool";
  if ("fullName" in event) return event.fullName;
  return [event.server, event.tool].filter(Boolean).join(".") || "MCP tool";
}

export function targetLabel(event: WatchtowerEvent) {
  const input = asRecord(event.input);
  return (
    stringValue(input?.path) ??
    stringValue(input?.title) ??
    stringValue(input?.to) ??
    stringValue(input?.subject) ??
    "selected target"
  );
}

export function summarizeInput(event: WatchtowerEvent) {
  const input = asRecord(event.input);
  const path = stringValue(input?.path);
  const title = stringValue(input?.title);
  const to = stringValue(input?.to);
  const subject = stringValue(input?.subject);
  if (path && event.tool?.includes("write")) return `Modify ${path}`;
  if (path) return `Use ${path}`;
  if (title && event.tool?.includes("create")) return `Create "${title}"`;
  if (to && event.tool?.includes("send")) return `Send ${subject ? `"${subject}" ` : ""}to ${to}`;
  return `Send input to ${formatToolName(event)}`;
}

export function formatDuration(start?: string | null, end?: string | null) {
  if (!start) return "Not available";
  const startTime = new Date(start).getTime();
  const endTime = end ? new Date(end).getTime() : Date.now();
  if (Number.isNaN(startTime) || Number.isNaN(endTime)) return "Not available";
  const seconds = Math.max(0, Math.round((endTime - startTime) / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function formatLatency(value?: number) {
  if (value === undefined) return "n/a";
  if (value < 1000) return `${value}ms`;
  return `${(value / 1000).toFixed(1)}s`;
}

export function formatTime(timestamp?: string | null) {
  if (!timestamp) return "n/a";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function formatDateTime(timestamp?: string | null) {
  if (!timestamp) return "n/a";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  return date.toLocaleString([], {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

export function prettyStatus(status: string) {
  return status.replaceAll("_", " ");
}

export function readableEventType(type: string) {
  return type
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function formatJson(value: unknown) {
  if (value === undefined || value === null) return "No payload";
  return JSON.stringify(value, null, 2);
}

export function formatError(value: unknown) {
  if (!value) return "No error payload";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

export function upsertRun(runs: Run[], nextRun: Run) {
  if (runs.some((run) => run.run_id === nextRun.run_id)) {
    return runs.map((run) => (run.run_id === nextRun.run_id ? nextRun : run));
  }
  return [nextRun, ...runs];
}

function item(
  event: WatchtowerEvent,
  title: string,
  message: string,
  tone: Tone,
  badge?: string,
  important?: boolean
): TimelineItem {
  return { event, title, message, tone, badge, important };
}

function getFirstApprovalGate(events: WatchtowerEvent[]) {
  return events.find(isApprovalRequiredEvent);
}

function getApprovalDecision(
  events: WatchtowerEvent[],
  intervention: WatchtowerEvent,
  decision: "approved" | "rejected"
) {
  const expectedType = decision === "approved" ? "tool_call_approved" : "tool_call_rejected";
  return events.find(
    (event) =>
      event.type === expectedType &&
      ((intervention.approval_id && event.approval_id === intervention.approval_id) || sameTool(event, intervention))
  );
}

function sameTool(a: WatchtowerEvent, b: WatchtowerEvent) {
  return Boolean(a.server && a.tool && a.server === b.server && a.tool === b.tool);
}

function isRisky(event: WatchtowerEvent) {
  return (
    event.metadata?.safety_action === "require_approval" ||
    event.metadata?.safety_action === "block" ||
    event.risk === "medium" ||
    event.risk === "high" ||
    event.risk === "critical"
  );
}

function isPolicyBlock(event: WatchtowerEvent) {
  const error = asRecord(event.error);
  return error?.code === "POLICY_BLOCKED" || event.metadata?.safety_action === "block";
}

function actionPhrase(event: WatchtowerEvent) {
  const target = targetLabel(event);
  if (event.tool?.includes("write")) return `modify ${target}`;
  if (event.tool?.includes("delete")) return `delete ${target}`;
  if (event.tool?.includes("send")) return `send data to ${target}`;
  if (event.tool?.includes("create")) return `create ${target}`;
  return `call ${formatToolName(event)}`;
}

function normalizeReason(reason?: string) {
  if (!reason) return "Can modify external state";
  return reason.replace(/^This tool may/i, "Can").replace(/^Tool may/i, "Can").replace(/\.$/, "");
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return undefined;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
