/**
 * MCP Watchtower — TypeScript SDK
 *
 * Emit agent events to a running Watchtower server and wrap MCP tool calls
 * with automatic observability, timing, and error capture.
 *
 * @example
 * ```ts
 * import { WatchtowerClient } from "mcp-watchtower";
 *
 * const wt = new WatchtowerClient({ baseUrl: "http://127.0.0.1:8123" });
 * const run = await wt.createRun({ appName: "my-ts-agent", task: "summarise inbox" });
 *
 * const wrapped = wt.wrapToolCaller(run.run_id, "gmail", async (tool, args) => {
 *   return await myMcpClient.callTool(tool, args);
 * });
 *
 * const result = await wrapped("list_messages", { max: 10 });
 * await wt.completeRun(run.run_id);
 * ```
 */

// ── Types ─────────────────────────────────────────────────────────────────

export type WatchtowerEvent = {
  event_id: string;
  run_id: string;
  parent_event_id?: string | null;
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

export type Run = {
  run_id: string;
  app_name: string;
  task?: string | null;
  status: string;
  started_at: string;
  completed_at?: string | null;
};

export type EmitPayload = Omit<
  Partial<WatchtowerEvent>,
  "event_id" | "run_id" | "timestamp"
> & {
  type: string;
  status: string;
  message: string;
};

export type ToolCallerFn = (
  tool: string,
  args: Record<string, unknown>
) => Promise<unknown>;

// ── Client ────────────────────────────────────────────────────────────────

export type WatchtowerClientOptions = {
  /** Base URL of a running Watchtower server. Default: http://127.0.0.1:8123 */
  baseUrl?: string;
  /** API token set via WATCHTOWER_API_TOKEN on the server side. */
  apiToken?: string;
  /** Fetch implementation (defaults to globalThis.fetch). */
  fetch?: typeof fetch;
};

export class WatchtowerClient {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private readonly _fetch: typeof fetch;

  constructor(options: WatchtowerClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? "http://127.0.0.1:8123").replace(/\/$/, "");
    this.headers = { "Content-Type": "application/json" };
    if (options.apiToken) {
      this.headers["Authorization"] = `Bearer ${options.apiToken}`;
    }
    this._fetch = options.fetch ?? globalThis.fetch;
  }

  // ── Run management ─────────────────────────────────────────────────────

  async createRun(opts: { appName: string; task?: string }): Promise<Run> {
    return this._post<Run>("/api/runs", {
      app_name: opts.appName,
      task: opts.task ?? null,
    });
  }

  async getRun(runId: string): Promise<Run> {
    return this._get<Run>(`/api/runs/${runId}`);
  }

  async listRuns(): Promise<Run[]> {
    return this._get<Run[]>("/api/runs");
  }

  async completeRun(runId: string): Promise<WatchtowerEvent> {
    return this.emit(runId, {
      type: "run_completed",
      status: "completed",
      message: "run completed",
    });
  }

  async failRun(runId: string, error: unknown): Promise<WatchtowerEvent> {
    const msg = error instanceof Error ? error.message : String(error);
    return this.emit(runId, {
      type: "run_failed",
      status: "failed",
      message: msg,
      error: msg,
    });
  }

  // ── Event emission ─────────────────────────────────────────────────────

  async emit(runId: string, payload: EmitPayload): Promise<WatchtowerEvent> {
    return this._post<WatchtowerEvent>(`/api/runs/${runId}/emit`, payload);
  }

  // ── Tool call wrapper ──────────────────────────────────────────────────

  /**
   * Wrap a tool-caller function with automatic Watchtower instrumentation.
   *
   * The wrapper emits `tool_call_started` before the call and
   * `tool_call_completed` / `tool_call_failed` after it, including latency.
   */
  wrapToolCaller(
    runId: string,
    serverName: string,
    caller: ToolCallerFn,
    opts: { risk?: string } = {}
  ): ToolCallerFn {
    return async (tool, args) => {
      const startedEvent = await this.emit(runId, {
        type: "tool_call_started",
        status: "running",
        message: `calling ${serverName}.${tool}`,
        server: serverName,
        tool,
        risk: opts.risk ?? "low",
        input: args,
      });

      const t0 = Date.now();
      try {
        const result = await caller(tool, args);
        await this.emit(runId, {
          type: "tool_call_completed",
          status: "completed",
          message: `${serverName}.${tool} completed`,
          server: serverName,
          tool,
          parent_event_id: startedEvent.event_id,
          latency_ms: Date.now() - t0,
          output_summary: summarise(result),
        });
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await this.emit(runId, {
          type: "tool_call_failed",
          status: "failed",
          message: `${serverName}.${tool} failed: ${msg}`,
          server: serverName,
          tool,
          parent_event_id: startedEvent.event_id,
          latency_ms: Date.now() - t0,
          error: msg,
        });
        throw err;
      }
    };
  }

  // ── Run context helper ─────────────────────────────────────────────────

  /**
   * Creates a run, calls fn, then marks the run completed (or failed).
   * Returns whatever fn returns.
   */
  async withRun<T>(
    opts: { appName: string; task?: string },
    fn: (run: Run, client: WatchtowerClient) => Promise<T>
  ): Promise<T> {
    const run = await this.createRun(opts);
    await this.emit(run.run_id, {
      type: "run_started",
      status: "running",
      message: opts.task ?? "run started",
    });
    try {
      const result = await fn(run, this);
      await this.completeRun(run.run_id);
      return result;
    } catch (err) {
      await this.failRun(run.run_id, err);
      throw err;
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────

  private async _get<T>(path: string): Promise<T> {
    const res = await this._fetch(`${this.baseUrl}${path}`, {
      headers: this.headers,
    });
    if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
    return res.json() as Promise<T>;
  }

  private async _post<T>(path: string, body: unknown): Promise<T> {
    const res = await this._fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`);
    return res.json() as Promise<T>;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

function summarise(value: unknown): unknown {
  if (typeof value === "string") {
    return value.length > 500 ? `${value.slice(0, 500)}… (truncated)` : value;
  }
  if (Array.isArray(value)) {
    return { length: value.length, first: value[0] };
  }
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value as object);
    return { keys: keys.slice(0, 10), count: keys.length };
  }
  return value;
}
