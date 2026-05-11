export type Tone = "success" | "warning" | "danger" | "active" | "neutral" | "brand";

export type RunMode =
  | "idle"
  | "running"
  | "waiting_for_approval"
  | "completed"
  | "failed"
  | "rejected"
  | "blocked";

export type RouteStatus = "future" | "current" | "completed" | "warning" | "blocked" | "failed";

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
  parent_event_id?: string | null;
  type: string;
  timestamp: string;
  status: string;
  message: string;
  server?: string;
  transport?: string;
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
  last_checked_at?: string;
  last_error?: string | null;
  metadata?: Record<string, unknown>;
};

export type RunEventsResponse = {
  run: Run;
  events: WatchtowerEvent[];
};

export type PrimaryToolCall = {
  server: string;
  tool: string;
  fullName: string;
  target: string;
  risk: string;
  reason: string;
  action: string;
  hasExecuted: boolean;
  decision: "waiting" | "approved" | "rejected" | "blocked" | null;
  event?: WatchtowerEvent;
};

export type RouteNode = {
  key: "task" | "agent" | "watchtower" | "policy" | "approval" | "mcp" | "result";
  label: string;
  detail: string;
  status: RouteStatus;
  badge?: string;
};

export type TimelineItem = {
  event: WatchtowerEvent;
  title: string;
  message: string;
  tone: Tone;
  badge?: string;
  important?: boolean;
};
