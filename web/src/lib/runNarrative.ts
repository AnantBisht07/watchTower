export type RunMode = "waiting_for_approval" | "completed" | "running" | "failed";
export type FlowTone = "active" | "brand" | "warning" | "success" | "danger" | "neutral";

export type Run = {
  run_id: string;
  app_name: string;
  task?: string | null;
  status: string;
  started_at: string;
  completed_at?: string | null;
};

export type WatchtowerEvent = {
  event_id: string;
  run_id: string;
  type: string;
  timestamp: string;
  status: string;
  message: string;
  server?: string;
  tool?: string;
  latency_ms?: number;
  risk?: string;
  reason?: string;
  approval_id?: string;
  input?: unknown;
  output_summary?: unknown;
  error?: unknown;
  metadata?: Record<string, unknown>;
};

export type Health = {
  server: string;
  status: string;
  tools_count: number;
  latency_ms?: number;
  last_error?: string | null;
};

export type RunNarrativeInput = {
  run: Run | null;
  events: WatchtowerEvent[];
  health?: Health[];
};

export type PrimaryToolCall = {
  server: string;
  tool: string;
  fullName: string;
  target: string;
  risk: string;
  riskReason: string;
  hasExecuted: boolean;
  decision: "waiting" | "approved" | "rejected" | null;
};

export type RunNarrative = {
  eyebrow: string;
  title: string;
  subtitle: string;
  story: string;
  status: string;
};

export type SystemFlowNode = {
  key: "agent" | "watchtower" | "mcp" | "result";
  label: string;
  detail: string;
  tone: FlowTone;
  badge?: string;
};

export function getRunMode(run: RunNarrativeInput): RunMode {
  if (getPendingApproval(run.events)) return "waiting_for_approval";
  if (run.run?.status === "failed" || run.events.some((event) => event.type === "run_failed")) {
    return "failed";
  }
  if (run.run?.status === "completed" || run.events.some((event) => event.type === "run_completed")) {
    return "completed";
  }
  return "running";
}

export function getPrimaryToolCall(run: RunNarrativeInput): PrimaryToolCall {
  const events = run.events;
  const approval = getIntervention(events);
  const requested =
    approval ??
    events.find(
      (event) =>
        event.type === "tool_call_requested" &&
        (event.metadata?.safety_action === "require_approval" ||
          event.risk === "medium" ||
          event.risk === "high" ||
          event.risk === "critical")
    ) ??
    [...events].reverse().find((event) => event.tool) ??
    ({} as WatchtowerEvent);

  const server = requested.server ?? "MCP server";
  const tool = requested.tool ?? "tool";
  const fullName = requested.server && requested.tool ? `${requested.server}.${requested.tool}` : tool;
  const approved = approval ? getApprovalDecision(events, approval, "approved") : undefined;
  const rejected = approval ? getApprovalDecision(events, approval, "rejected") : undefined;
  const hasExecuted = Boolean(
    requested.server &&
      requested.tool &&
      events.some(
        (event) =>
          (event.type === "tool_call_started" || event.type === "tool_call_completed") &&
          event.server === requested.server &&
          event.tool === requested.tool
      )
  );

  return {
    server,
    tool,
    fullName,
    target: targetLabel(requested),
    risk: requested.risk ?? "unknown",
    riskReason: normalizeRiskReason(requested.reason),
    hasExecuted,
    decision: getPendingApproval(events) ? "waiting" : approved ? "approved" : rejected ? "rejected" : null
  };
}

export function getNarrative(run: RunNarrativeInput): RunNarrative {
  const mode = getRunMode(run);
  const toolCall = getPrimaryToolCall(run);

  if (mode === "waiting_for_approval") {
    return {
      eyebrow: "WAITING FOR YOUR DECISION",
      title: "Watchtower paused a risky tool call",
      subtitle: `The agent requested ${toolCall.fullName}. Watchtower intercepted this request before it reached the MCP server.`,
      story: `The agent is trying to ${actionPhrase(toolCall)}. Watchtower paused the run because this action can modify external state.`,
      status: "waiting"
    };
  }

  if (mode === "completed" && toolCall.decision === "approved") {
    return {
      eyebrow: "RUN PROTECTED",
      title: "Watchtower protected this run",
      subtitle:
        "Watchtower intercepted a risky file write, paused it for approval, and only forwarded it to MCP after a human approved.",
      story: `The agent requested ${toolCall.fullName} to write ${toolCall.target}. Because file writing changes external state, Watchtower stopped the run at a safety gate. After approval, the tool executed successfully.`,
      status: "protected"
    };
  }

  if (mode === "failed") {
    return {
      eyebrow: "RUN STOPPED",
      title: "Watchtower detected a broken tool",
      subtitle: "The run stopped because an MCP server or tool failed.",
      story: "Open the failed step in the inspector and check whether the MCP server is healthy.",
      status: "failed"
    };
  }

  return {
    eyebrow: "LIVE RUN",
    title: "Agent journey in progress",
    subtitle: "Watchtower is showing each MCP tool call as it happens.",
    story: "Your agent is travelling through MCP tools. Watch the route, inspect each stop, and approve risky turns before it continues.",
    status: "running"
  };
}

export function getSystemFlow(run: RunNarrativeInput): SystemFlowNode[] {
  const mode = getRunMode(run);
  const toolCall = getPrimaryToolCall(run);

  if (mode === "waiting_for_approval") {
    return [
      { key: "agent", label: "Agent", detail: `requested ${toolCall.fullName}`, tone: "active" },
      { key: "watchtower", label: "Watchtower", detail: "holding for approval", tone: "warning" },
      { key: "mcp", label: "MCP Tool", detail: "not executed yet", tone: "neutral" },
      { key: "result", label: "Result", detail: "waiting for decision", tone: "neutral" }
    ];
  }

  if (mode === "completed" && toolCall.decision === "approved") {
    return [
      { key: "agent", label: "Agent", detail: `requested ${toolCall.tool}`, tone: "neutral" },
      {
        key: "watchtower",
        label: "Watchtower",
        detail: "approved and forwarded",
        tone: "brand",
        badge: "key intervention"
      },
      { key: "mcp", label: "MCP Tool", detail: "executed safely", tone: "success" },
      {
        key: "result",
        label: "Result",
        detail: toolCall.tool.includes("write") ? "write completed" : "tool completed",
        tone: "success"
      }
    ];
  }

  if (mode === "failed") {
    return [
      { key: "agent", label: "Agent", detail: `requested ${toolCall.fullName}`, tone: "active" },
      { key: "watchtower", label: "Watchtower", detail: "detected failure", tone: "danger" },
      { key: "mcp", label: "MCP Tool", detail: "failed or unhealthy", tone: "danger" },
      { key: "result", label: "Result", detail: "run stopped", tone: "danger" }
    ];
  }

  return [
    { key: "agent", label: "Agent", detail: `requesting ${toolCall.fullName}`, tone: "active" },
    { key: "watchtower", label: "Watchtower", detail: "checking request", tone: "active" },
    {
      key: "mcp",
      label: "MCP Tool",
      detail: toolCall.hasExecuted ? "executing" : "waiting for clearance",
      tone: toolCall.hasExecuted ? "active" : "neutral"
    },
    { key: "result", label: "Result", detail: "not ready yet", tone: "neutral" }
  ];
}

export function isApprovalRequiredEvent(event: WatchtowerEvent) {
  return event.type === "approval_required" || event.type === "tool_call_approval_required";
}

export function getPendingApproval(events: WatchtowerEvent[]) {
  const decided = new Set(
    events
      .filter((event) => event.type === "tool_call_approved" || event.type === "tool_call_rejected")
      .map((event) => event.approval_id)
      .filter(Boolean)
  );
  return [...events]
    .reverse()
    .find((event) => isApprovalRequiredEvent(event) && !decided.has(event.approval_id));
}

export function getIntervention(events: WatchtowerEvent[]) {
  return events.find(isApprovalRequiredEvent);
}

export function getApprovalDecision(
  events: WatchtowerEvent[],
  intervention: WatchtowerEvent,
  decision: "approved" | "rejected"
) {
  const expectedType = decision === "approved" ? "tool_call_approved" : "tool_call_rejected";
  return events.find(
    (event) =>
      event.type === expectedType &&
      ((intervention.approval_id && event.approval_id === intervention.approval_id) ||
        (event.server === intervention.server && event.tool === intervention.tool))
  );
}

function normalizeRiskReason(reason: string | undefined) {
  if (!reason) return "Can modify external state";
  return reason.replace(/^This tool may/i, "Can").replace(/^Tool may/i, "Can").replace(/\.$/, "");
}

function actionPhrase(toolCall: PrimaryToolCall) {
  if (toolCall.tool.includes("write")) return `write ${toolCall.target}`;
  if (toolCall.tool.includes("delete")) return `delete ${toolCall.target}`;
  if (toolCall.tool.includes("send")) return `send data to ${toolCall.target}`;
  return `call ${toolCall.fullName}`;
}

function targetLabel(event: WatchtowerEvent) {
  const input = asRecord(event.input);
  return (
    stringValue(input?.path) ??
    stringValue(input?.title) ??
    stringValue(input?.to) ??
    stringValue(input?.subject) ??
    "the selected target"
  );
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return undefined;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}
