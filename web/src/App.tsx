import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  CirclePlay,
  Clock3,
  FileJson,
  Flag,
  ListChecks,
  Play,
  PlugZap,
  Route,
  Server,
  ShieldAlert,
  ShieldCheck,
  Wrench,
  XCircle
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  getNarrative,
  getPrimaryToolCall,
  getRunMode,
  getSystemFlow,
  type PrimaryToolCall,
  type RunMode as NarrativeRunMode,
  type RunNarrative,
  type SystemFlowNode
} from "./lib/runNarrative";

type Tone = "success" | "warning" | "danger" | "active" | "neutral";
type RunState = "idle" | "running" | "waiting_for_approval" | "completed" | "failed";
type RouteStatus = "completed" | "current" | "blocked" | "failed" | "future";

type Run = {
  run_id: string;
  app_name: string;
  task?: string | null;
  status: string;
  started_at: string;
  completed_at?: string | null;
};

type WatchtowerEvent = {
  event_id: string;
  run_id: string;
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

type Health = {
  server: string;
  status: string;
  tools_count: number;
  latency_ms?: number;
  last_checked_at?: string;
  last_error?: string | null;
  metadata?: Record<string, unknown>;
};

type RunEventsResponse = {
  run: Run;
  events: WatchtowerEvent[];
};

type JourneyStep = {
  event: WatchtowerEvent;
  title: string;
  explanation: string;
  tone: Tone;
  icon: React.ReactNode;
  badge?: string;
};

type TimelinePhase = {
  key: string;
  title: string;
  description: string;
  tone: Tone;
  items: { step: JourneyStep; number: number }[];
};

type RouteNode = {
  key: string;
  label: string;
  status: RouteStatus;
  icon: React.ReactNode;
  badge?: string;
  keyMoment?: boolean;
};

const eventTypes = [
  "run_started",
  "run_completed",
  "run_failed",
  "agent_step_started",
  "agent_step_completed",
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

export function App() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [activeRun, setActiveRun] = useState<Run | null>(null);
  const [events, setEvents] = useState<WatchtowerEvent[]>([]);
  const [health, setHealth] = useState<Health[]>([]);
  const [selected, setSelected] = useState<WatchtowerEvent | null>(null);
  const [approvalBusy, setApprovalBusy] = useState<string | null>(null);
  const streamRef = useRef<EventSource | null>(null);

  useEffect(() => {
    void refreshRuns();
    void refreshHealth();
    return () => streamRef.current?.close();
  }, []);

  async function refreshRuns() {
    const response = await fetch("/api/runs");
    const nextRuns = (await response.json()) as Run[];
    setRuns(nextRuns);
    if (!activeRun && nextRuns.length > 0) {
      await openRun(nextRuns[0]);
    }
  }

  async function refreshHealth() {
    const response = await fetch("/api/servers/health");
    setHealth((await response.json()) as Health[]);
  }

  async function startDemo() {
    const response = await fetch("/api/runs/demo", { method: "POST" });
    const run = (await response.json()) as Run;
    setRuns((current) => [run, ...current]);
    await openRun(run);
  }

  async function startSafetyDemo() {
    const response = await fetch("/api/runs/safety-demo", { method: "POST" });
    const run = (await response.json()) as Run;
    setRuns((current) => [run, ...current]);
    await openRun(run);
  }

  async function openRun(run: Run) {
    streamRef.current?.close();
    setActiveRun(run);
    setSelected(null);

    const existing = (await fetch(`/api/runs/${run.run_id}/events`).then((res) =>
      res.json()
    )) as RunEventsResponse;
    setActiveRun(existing.run);
    setRuns((current) => upsertRun(current, existing.run));
    setEvents(existing.events);

    const source = new EventSource(`/api/runs/${run.run_id}/events/stream`);
    eventTypes.forEach((type) => {
      source.addEventListener(type, (event) => {
        const payload = JSON.parse((event as MessageEvent).data) as WatchtowerEvent;
        setEvents((current) => {
          if (current.some((item) => item.event_id === payload.event_id)) return current;
          return [...current, payload];
        });
        if (isHealthEvent(payload)) void refreshHealth();
        if (payload.type === "run_completed" || payload.type === "run_failed") {
          const status = payload.type === "run_completed" ? "completed" : "failed";
          const completedAt = payload.timestamp;
          setActiveRun((current) =>
            current && current.run_id === payload.run_id
              ? { ...current, status, completed_at: completedAt }
              : current
          );
          setRuns((current) =>
            current.map((run) =>
              run.run_id === payload.run_id ? { ...run, status, completed_at: completedAt } : run
            )
          );
          void refreshRuns();
        }
      });
    });
    streamRef.current = source;
  }

  async function decideApproval(approvalId: string, decision: "approve" | "reject") {
    setApprovalBusy(approvalId);
    try {
      await fetch(`/api/approvals/${approvalId}/${decision}`, { method: "POST" });
    } finally {
      setApprovalBusy(null);
    }
  }

  const journeySteps = useMemo(() => getTimelineSteps(events), [events]);
  const timelinePhases = useMemo(() => getTimelinePhases(journeySteps), [journeySteps]);
  const pendingApproval = useMemo(() => getCurrentDecision(events), [events]);
  const intervention = useMemo(() => getIntervention(events), [events]);
  const routeNodes = useMemo(() => getRouteNodes(events, activeRun), [events, activeRun]);
  const narrative = useMemo(
    () => getNarrative({ run: activeRun, events, health }),
    [activeRun, events, health]
  );
  const primaryToolCall = useMemo(
    () => getPrimaryToolCall({ run: activeRun, events, health }),
    [activeRun, events, health]
  );
  const runMode = useMemo(() => getRunMode({ run: activeRun, events, health }), [activeRun, events, health]);
  const systemFlow = useMemo(
    () => getSystemFlow({ run: activeRun, events, health }),
    [activeRun, events, health]
  );
  const focusedEvent = selected ?? pendingApproval ?? intervention ?? [...events].reverse()[0] ?? null;
  const focusedStep = focusedEvent ? getStepDisplay(focusedEvent, events) : null;

  return (
    <main className="appShell">
      <header className="appHeader">
        <div>
          <p className="eyebrow">Live journey and control layer</p>
          <h1>MCP Watchtower</h1>
          <p className="headerSubtitle">Live control layer for MCP agents</p>
          <p>Watch MCP tool calls live, pause risky actions, and detect unhealthy tools.</p>
        </div>
        <div className="headerActions">
          <button className="secondaryButton" onClick={startDemo}>
            <Play size={18} />
            Journey demo
          </button>
          <button className="primaryButton" onClick={startSafetyDemo}>
            <ShieldCheck size={18} />
            Safety demo
          </button>
        </div>
      </header>

      <section className="runPicker">
        <label htmlFor="run-select">Selected run</label>
        <select
          id="run-select"
          value={activeRun?.run_id ?? ""}
          onChange={(event) => {
            const run = runs.find((item) => item.run_id === event.target.value);
            if (run) void openRun(run);
          }}
        >
          <option value="" disabled>
            Start a demo run
          </option>
          {runs.map((run) => (
            <option key={run.run_id} value={run.run_id}>
              {runScenario(run).name} - {run.status}
            </option>
          ))}
        </select>
      </section>

      <RunStatusHero
        run={activeRun}
        events={events}
        pendingApproval={pendingApproval}
        approvalBusy={approvalBusy}
        onDecision={decideApproval}
        narrative={narrative}
        primaryToolCall={primaryToolCall}
        runMode={runMode}
      />

      <SystemFlow nodes={systemFlow} />

      <RouteProgress nodes={routeNodes} />

      <div className="runGrid">
        <section className="journeySection">
          <div className="sectionHeader">
            <div>
              <p className="eyebrow">Control timeline</p>
              <h2>How Watchtower handled the tool call</h2>
              <p className="sectionLead">
                Every step where Watchtower checked health, detected risk, paused execution, or forwarded the
                approved request.
              </p>
            </div>
            <Badge tone={getRunStateTone(runMode)}>{prettyStatus(runMode)}</Badge>
          </div>
          <div className="journeyList">
            {timelinePhases.map((phase) => (
              <section key={phase.key} className={`timelinePhase ${phase.tone}`}>
                <div className="phaseHeader">
                  <span>{phase.title}</span>
                  <small>{phase.description}</small>
                </div>
                <div className="phaseSteps">
                  {phase.items.map(({ step, number }) => (
                    <button
                      key={step.event.event_id}
                      className={`journeyStep ${step.tone} ${
                        focusedEvent?.event_id === step.event.event_id ? "selected" : ""
                      }`}
                      onClick={() => setSelected(step.event)}
                    >
                      <span className="stepIcon">{step.icon}</span>
                      <span className="stepContent">
                        <span className="stepKicker">Step {number}</span>
                        <span className="stepTitleRow">
                          <strong>{step.title}</strong>
                          {step.badge ? <span className="interventionBadge">{step.badge}</span> : null}
                        </span>
                        <small>{step.explanation}</small>
                        <StepMeta step={step} />
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            ))}
            {journeySteps.length === 0 ? (
              <p className="emptyState">Start a demo run to see the agent route.</p>
            ) : null}
          </div>
        </section>

        <Inspector
          pendingApproval={pendingApproval}
          approvalBusy={approvalBusy}
          onDecision={decideApproval}
          health={health}
          step={focusedStep}
          events={events}
          primaryToolCall={primaryToolCall}
          runMode={runMode}
        />
      </div>

    </main>
  );
}

function RunStatusHero({
  run,
  events,
  pendingApproval,
  approvalBusy,
  onDecision,
  narrative,
  primaryToolCall,
  runMode
}: {
  run: Run | null;
  events: WatchtowerEvent[];
  pendingApproval?: WatchtowerEvent;
  approvalBusy: string | null;
  onDecision: (approvalId: string, decision: "approve" | "reject") => Promise<void>;
  narrative: RunNarrative;
  primaryToolCall: PrimaryToolCall;
  runMode: NarrativeRunMode;
}) {
  const latestStep = [...events].reverse()[0];
  const failed = [...events].reverse().find(isFailureEvent);

  if (!run) {
    return (
      <section className="stateHero neutral">
        <div className="stateIcon">
          <Route size={26} />
        </div>
        <div className="stateMain">
          <p className="eyebrow">Run detail</p>
          <h2>Start a journey to watch the route</h2>
          <p>Your agent is travelling through MCP tools. Watch each stop and approve risky turns before it continues.</p>
        </div>
      </section>
    );
  }

  if (runMode === "waiting_for_approval" && pendingApproval?.approval_id) {
    return (
      <section className="stateHero warning">
        <div className="stateIcon">
          <ShieldAlert size={28} />
        </div>
        <div className="stateMain">
          <p className="eyebrow">{narrative.eyebrow}</p>
          <h2>{narrative.title}</h2>
          <p>{narrative.subtitle}</p>
          <p className="storyParagraph">{narrative.story}</p>
          <WhyThisMatters primaryToolCall={primaryToolCall} />
          <ApprovalSummary primaryToolCall={primaryToolCall} />
          <DecisionButtons
            approvalId={pendingApproval.approval_id}
            approvalBusy={approvalBusy}
            onDecision={onDecision}
            approveLabel="Approve and forward to MCP"
            rejectLabel="Reject and block tool call"
          />
        </div>
      </section>
    );
  }

  if (runMode === "completed") {
    const intervention = getIntervention(events);
    const approved = intervention ? getApprovalDecision(events, intervention, "approved") : undefined;
    if (intervention && approved) {
      return (
        <section className="stateHero success protectedHero">
          <div className="stateIcon">
            <ShieldCheck size={28} />
          </div>
          <div className="stateMain">
            <p className="eyebrow">{narrative.eyebrow}</p>
            <h2>{narrative.title}</h2>
            <p>{narrative.subtitle}</p>
            <p className="storyParagraph">{narrative.story}</p>
            <WhyThisMatters primaryToolCall={primaryToolCall} />
            <div className="outcomeChips">
              <OutcomeChip label="Risky tool" value={primaryToolCall.fullName} />
              <OutcomeChip label="Target" value={primaryToolCall.target} />
              <OutcomeChip label="Decision" value="Approved" />
              <OutcomeChip label="Result" value="Forwarded + executed" />
              <OutcomeChip
                label="Tool health"
                value={serverWasHealthy(events, primaryToolCall.server) ? "Healthy" : "Checked"}
              />
            </div>
          </div>
        </section>
      );
    }

    return (
      <section className="stateHero success">
        <div className="stateIcon">
          <CheckCircle2 size={28} />
        </div>
        <div className="stateMain">
          <p className="eyebrow">Run complete</p>
          <h2>Agent journey completed</h2>
          <p>The agent finished its MCP tool journey successfully.</p>
          <HeroStats run={run} events={events} />
        </div>
      </section>
    );
  }

  if (runMode === "failed") {
    return (
      <section className="stateHero danger">
        <div className="stateIcon">
          <AlertTriangle size={28} />
        </div>
        <div className="stateMain">
          <p className="eyebrow">{narrative.eyebrow}</p>
          <h2>{narrative.title}</h2>
          <p>{narrative.subtitle}</p>
          <dl className="heroFacts">
            <div>
              <dt>Failed step</dt>
              <dd>{failed ? getStepDisplay(failed, events).title : "Unknown failure"}</dd>
            </div>
            <div>
              <dt>Error reason</dt>
              <dd>{formatError(failed?.error) ?? failed?.message ?? "Inspect the failed step."}</dd>
            </div>
            <div>
              <dt>Suggested next action</dt>
              <dd>Open the failed step in the inspector and check server health.</dd>
            </div>
          </dl>
        </div>
      </section>
    );
  }

  return (
    <section className="stateHero active">
      <div className="stateIcon">
        <Clock3 size={28} />
      </div>
      <div className="stateMain">
        <p className="eyebrow">{narrative.eyebrow}</p>
        <h2>{narrative.title}</h2>
        <p>{narrative.subtitle}</p>
        <p className="storyParagraph">{narrative.story}</p>
        <dl className="heroFacts">
          <div>
            <dt>Current step</dt>
            <dd>{latestStep ? getStepDisplay(latestStep, events).title : "Waiting for first event"}</dd>
          </div>
          <div>
            <dt>Current tool</dt>
            <dd>{latestStep ? displayTool(latestStep) : "No tool yet"}</dd>
          </div>
          <div>
            <dt>Elapsed time</dt>
            <dd>{formatDuration(run.started_at, latestStep?.timestamp)}</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

function ApprovalSummary({ primaryToolCall }: { primaryToolCall: PrimaryToolCall }) {
  return (
    <dl className="heroFacts">
      <div>
        <dt>Agent requested</dt>
        <dd>{primaryToolCall.fullName}</dd>
      </div>
      <div>
        <dt>Target</dt>
        <dd>{primaryToolCall.target}</dd>
      </div>
      <div>
        <dt>Risk</dt>
        <dd>{capitalize(primaryToolCall.risk)}</dd>
      </div>
      <div>
        <dt>Why this matters</dt>
        <dd>{primaryToolCall.riskReason}</dd>
      </div>
      <div>
        <dt>MCP execution</dt>
        <dd>{primaryToolCall.hasExecuted ? "Forwarded to MCP" : "Not executed yet"}</dd>
      </div>
      <div>
        <dt>Status</dt>
        <dd>Waiting for your decision</dd>
      </div>
    </dl>
  );
}

function HeroStats({ run, events }: { run: Run; events: WatchtowerEvent[] }) {
  const toolCalls = events.filter((event) => event.type === "tool_call_requested").length;
  const reviewed = events.filter(
    (event) => event.type === "tool_call_approved" || event.type === "tool_call_rejected"
  ).length;
  const failed = events.filter(isFailureEvent).length;
  return (
    <dl className="heroFacts">
      <div>
        <dt>Tools called</dt>
        <dd>{toolCalls}</dd>
      </div>
      <div>
        <dt>Risky actions reviewed</dt>
        <dd>{reviewed}</dd>
      </div>
      <div>
        <dt>Failed tools</dt>
        <dd>{failed}</dd>
      </div>
      <div>
        <dt>Duration</dt>
        <dd>{formatDuration(run.started_at, run.completed_at ?? undefined)}</dd>
      </div>
    </dl>
  );
}

function OutcomeChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="outcomeChip">
      <small>{label}</small>
      <strong>{value}</strong>
    </span>
  );
}

function WhyThisMatters({ primaryToolCall }: { primaryToolCall: PrimaryToolCall }) {
  return (
    <div className="heroCallout">
      <h3>Why this matters</h3>
      <p>
        Without Watchtower, the agent could call {primaryToolCall.fullName} directly. With Watchtower, the request was
        intercepted, reviewed, approved, and then forwarded to MCP.
      </p>
    </div>
  );
}

function SystemFlow({ nodes }: { nodes: SystemFlowNode[] }) {
  return (
    <section className="systemFlowCard">
      <div className="sectionHeader compact">
        <div>
          <p className="eyebrow">Interception layer</p>
          <h2>How Watchtower is controlling this run</h2>
          <p className="sectionLead">
            The agent does not call the MCP tool directly. Watchtower sits in the middle and decides whether to
            forward or block the request.
          </p>
        </div>
      </div>
      <div className="systemFlow">
        {nodes.map((node, index) => (
          <div key={node.key} className="flowItem">
            <div className={getFlowNodeClass(node)}>
              <span className="flowIcon">{flowIcon(node.key)}</span>
              <span>
                <strong>{node.label}</strong>
                <small>{node.detail}</small>
              </span>
              {node.badge ? <span className="flowBadge">{node.badge}</span> : null}
            </div>
            {index < nodes.length - 1 ? <span className="flowArrow">-&gt;</span> : null}
          </div>
        ))}
      </div>
    </section>
  );
}

function flowIcon(key: SystemFlowNode["key"]) {
  if (key === "agent") return <CirclePlay size={18} />;
  if (key === "watchtower") return <ShieldAlert size={18} />;
  if (key === "mcp") return <Server size={18} />;
  return <Flag size={18} />;
}

function getFlowNodeClass(node: SystemFlowNode) {
  return `flowNode ${getNodeTone(node)} ${node.badge ? "highlight" : ""}`;
}

function getNodeTone(node: SystemFlowNode) {
  return node.tone;
}

function RouteProgress({ nodes }: { nodes: RouteNode[] }) {
  return (
    <section className="routeCard">
      <div className="sectionHeader compact">
        <div>
          <p className="eyebrow">Agent Route</p>
          <h2>Agent route</h2>
          <p className="sectionLead">Where Watchtower intervened and how the run finished.</p>
        </div>
      </div>
      <div className="routeStrip">
        {nodes.map((node, index) => (
          <div key={node.key} className={`routeNode ${node.status} ${node.keyMoment ? "keyMoment" : ""}`}>
            <span className="nodeIcon">{node.icon}</span>
            <strong>{node.label}</strong>
            {node.badge ? <span className="routeBadge">{node.badge}</span> : null}
            {index < nodes.length - 1 ? <span className="nodeConnector" /> : null}
          </div>
        ))}
      </div>
    </section>
  );
}

function StepMeta({ step }: { step: JourneyStep }) {
  const hasTool = Boolean(step.event.server || step.event.tool);
  const showStatus = step.event.status === "failed";
  const showRisk = Boolean(step.event.risk && (step.badge || isApprovalRequiredEvent(step.event)));
  return (
    <span className="stepMeta">
      <small>{timeOnly(step.event.timestamp)}</small>
      {hasTool ? <small>{displayTool(step.event)}</small> : null}
      {showRisk ? <Badge tone={getRiskTone(step.event.risk ?? "")}>{step.event.risk} risk</Badge> : null}
      {showStatus ? <Badge tone={getStatusTone(step.event.status)}>{prettyStatus(step.event.status)}</Badge> : null}
      {step.event.latency_ms !== undefined ? <small>{step.event.latency_ms}ms</small> : null}
    </span>
  );
}

function Inspector({
  pendingApproval,
  approvalBusy,
  onDecision,
  health,
  step,
  events,
  primaryToolCall,
  runMode
}: {
  pendingApproval?: WatchtowerEvent;
  approvalBusy: string | null;
  onDecision: (approvalId: string, decision: "approve" | "reject") => Promise<void>;
  health: Health[];
  step: JourneyStep | null;
  events: WatchtowerEvent[];
  primaryToolCall: PrimaryToolCall;
  runMode: NarrativeRunMode;
}) {
  return (
    <aside className="inspector">
      <div className="sectionHeader compact">
        <div>
          <p className="eyebrow">Inspector</p>
          <h2>Details</h2>
        </div>
      </div>
      {pendingApproval?.approval_id ? (
        <section className="inspectorBlock approvalBlock">
          <div className="blockTitle">
            <ShieldAlert size={18} />
            <h3>Review risky action</h3>
          </div>
          <dl className="detailList">
            <div>
              <dt>Tool</dt>
              <dd>{primaryToolCall.fullName}</dd>
            </div>
            <div>
              <dt>Risk</dt>
              <dd>{capitalize(primaryToolCall.risk)}</dd>
            </div>
            <div>
              <dt>Reason</dt>
              <dd>{primaryToolCall.riskReason}</dd>
            </div>
            <div>
              <dt>What will change?</dt>
              <dd>{primaryToolCall.tool.includes("write") ? `Writes ${primaryToolCall.target}` : summarizeInput(pendingApproval)}</dd>
            </div>
          </dl>
          <div className="nextSteps">
            <h4>What happens next?</h4>
            <p>
              <strong>Before approval:</strong> {primaryToolCall.fullName} has not executed yet.
            </p>
            <p>
              <strong>If you approve:</strong> Watchtower will forward this request to the{" "}
              {primaryToolCall.server} MCP server.
            </p>
            <p>
              <strong>If you reject:</strong> Watchtower will block this tool call and stop the run.
            </p>
          </div>
          <PreviewBlock title="Input preview" value={pendingApproval.input ?? {}} />
          <DecisionButtons
            approvalId={pendingApproval.approval_id}
            approvalBusy={approvalBusy}
            onDecision={onDecision}
            approveLabel="Approve and forward"
            rejectLabel="Reject and block"
          />
        </section>
      ) : null}

      {!pendingApproval ? (
        <OutcomePanel step={step} health={health} events={events} primaryToolCall={primaryToolCall} />
      ) : null}
      <ToolHealth health={health} />
      <SelectedStep step={step} primaryToolCall={primaryToolCall} />
    </aside>
  );
}

function OutcomePanel({
  step,
  health,
  events,
  primaryToolCall
}: {
  step: JourneyStep | null;
  health: Health[];
  events: WatchtowerEvent[];
  primaryToolCall: PrimaryToolCall;
}) {
  const intervention = getIntervention(events);
  const completedTool = intervention ? getCompletedToolEvent(events, intervention) : undefined;
  const approved = intervention ? getApprovalDecision(events, intervention, "approved") : undefined;
  const event = intervention ?? step?.event;
  const target = event ? targetLabel(event) : "No target selected";
  const server = primaryToolCall.server !== "MCP server" ? primaryToolCall.server : event?.server;
  const serverHealth =
    server && health.find((item) => item.server === server)
      ? `${server} ${health.find((item) => item.server === server)?.status}`
      : health[0]
        ? `${health[0].server} ${health[0].status}`
        : "No health check yet";
  const protectedOutcome = Boolean(intervention && approved);
  const latency = completedTool?.latency_ms ?? event?.latency_ms;

  return (
    <section className="inspectorBlock outcomeBlock">
      <div className="blockTitle">
        <ShieldCheck size={18} />
        <h3>Outcome</h3>
      </div>
      <dl className="detailList outcomeList">
        <div>
          <dt>Status</dt>
          <dd>{protectedOutcome ? "Approved and executed safely" : event ? executionSummary(event) : "No outcome yet"}</dd>
        </div>
        <div>
          <dt>What Watchtower did</dt>
          <dd>
            {protectedOutcome
              ? "Intercepted the request, waited for approval, then forwarded it to MCP."
              : event
                ? outcomeSummary(event)
                : "Select a step to see what Watchtower proved."}
          </dd>
        </div>
        <div>
          <dt>Tool</dt>
          <dd>{event ? primaryToolCall.fullName : "No tool selected"}</dd>
        </div>
        <div>
          <dt>Target</dt>
          <dd>{intervention ? primaryToolCall.target : target}</dd>
        </div>
        {protectedOutcome ? (
          <div>
            <dt>Decision</dt>
            <dd>Approved by human</dd>
          </div>
        ) : null}
        <div>
          <dt>MCP server</dt>
          <dd>{serverHealth}</dd>
        </div>
        {latency !== undefined ? (
          <div>
            <dt>Latency</dt>
            <dd>{latency}ms</dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}

function DecisionButtons({
  approvalId,
  approvalBusy,
  onDecision,
  approveLabel = "Approve and continue",
  rejectLabel = "Reject and stop"
}: {
  approvalId: string;
  approvalBusy: string | null;
  onDecision: (approvalId: string, decision: "approve" | "reject") => Promise<void>;
  approveLabel?: string;
  rejectLabel?: string;
}) {
  return (
    <div className="decisionActions">
      <button
        className="approveButton"
        disabled={approvalBusy === approvalId}
        onClick={() => void onDecision(approvalId, "approve")}
      >
        {approveLabel}
      </button>
      <button
        className="rejectButton"
        disabled={approvalBusy === approvalId}
        onClick={() => void onDecision(approvalId, "reject")}
      >
        {rejectLabel}
      </button>
    </div>
  );
}

function ToolHealth({ health }: { health: Health[] }) {
  return (
    <section className="inspectorBlock">
      <div className="blockTitle">
        <Server size={18} />
        <h3>Tool Health</h3>
      </div>
      <div className="healthList">
        {health.map((item) => (
          <div key={item.server} className="healthRow">
            <span className={`healthDot ${getHealthTone(item)}`} />
            <span>
              <strong>{item.server}</strong>
              <small>
                {item.status} / {item.tools_count} tools
                {item.latency_ms !== undefined ? ` / ${item.latency_ms}ms` : ""}
              </small>
              {item.last_error ? <small>{item.last_error}</small> : null}
            </span>
          </div>
        ))}
        {health.length === 0 ? <p className="emptyState">No health checks yet.</p> : null}
      </div>
    </section>
  );
}

function SelectedStep({ step, primaryToolCall }: { step: JourneyStep | null; primaryToolCall: PrimaryToolCall }) {
  return (
    <section className="inspectorBlock">
      <div className="blockTitle">
        <FileJson size={18} />
        <h3>Selected Step Details</h3>
      </div>
      {step ? (
        <>
          <div className={`stepMeaning ${step.tone}`}>
            <strong>{step.title}</strong>
            <p>{step.explanation}</p>
          </div>
          {isKeyInterventionStep(step) ? <KeyInterventionDetails primaryToolCall={primaryToolCall} /> : null}
          <DetailGrid event={step.event} />
          {step.event.input !== undefined ? <PreviewBlock title="Tool input" value={step.event.input} /> : null}
          {step.event.output_summary !== undefined ? (
            <PreviewBlock title="Tool output" value={step.event.output_summary} />
          ) : null}
          {step.event.error !== undefined ? <PreviewBlock title="Error" value={step.event.error} /> : null}
          <details className="rawDetails">
            <summary>Show raw event JSON</summary>
            <pre className="jsonBlock">{JSON.stringify(step.event, null, 2)}</pre>
          </details>
        </>
      ) : (
        <p className="emptyState">Select a journey step to inspect input, output, risk, and timing.</p>
      )}
    </section>
  );
}

function KeyInterventionDetails({ primaryToolCall }: { primaryToolCall: PrimaryToolCall }) {
  return (
    <div className="keyInterventionDetails">
      <strong>Key intervention</strong>
      <dl className="detailList">
        <div>
          <dt>Before Watchtower</dt>
          <dd>Agent wanted to call {primaryToolCall.fullName}.</dd>
        </div>
        <div>
          <dt>Watchtower action</dt>
          <dd>Held the request and waited for approval.</dd>
        </div>
        <div>
          <dt>MCP execution</dt>
          <dd>Not executed until approval.</dd>
        </div>
      </dl>
    </div>
  );
}

function isKeyInterventionStep(step: JourneyStep) {
  return (
    step.badge === "Key intervention" ||
    step.title === "Watchtower paused the tool call" ||
    step.title === "Watchtower detected risk"
  );
}

function DetailGrid({ event }: { event: WatchtowerEvent }) {
  return (
    <dl className="detailGrid">
      <div>
        <dt>Status</dt>
        <dd>{prettyStatus(event.status)}</dd>
      </div>
      {event.server ? (
        <div>
          <dt>Server</dt>
          <dd>{event.server}</dd>
        </div>
      ) : null}
      {event.tool ? (
        <div>
          <dt>Tool</dt>
          <dd>{event.tool}</dd>
        </div>
      ) : null}
      <div>
        <dt>Timestamp</dt>
        <dd>{event.timestamp}</dd>
      </div>
      {event.latency_ms !== undefined ? (
        <div>
          <dt>Latency</dt>
          <dd>{event.latency_ms}ms</dd>
        </div>
      ) : null}
      {event.risk ? (
        <div>
          <dt>Risk level</dt>
          <dd>{event.risk}</dd>
        </div>
      ) : null}
      {event.reason ? (
        <div>
          <dt>Risk reason</dt>
          <dd>{event.reason}</dd>
        </div>
      ) : null}
      {typeof event.metadata?.decision === "string" ? (
        <div>
          <dt>Approval decision</dt>
          <dd>{event.metadata.decision}</dd>
        </div>
      ) : null}
    </dl>
  );
}

function PreviewBlock({ title, value }: { title: string; value: unknown }) {
  return (
    <div className="previewBlock">
      <strong>{title}</strong>
      <pre>{JSON.stringify(value, null, 2)}</pre>
    </div>
  );
}

function Badge({ children, tone }: { children: React.ReactNode; tone: Tone }) {
  return <span className={getBadgeClass(tone)}>{children}</span>;
}

function getBadgeClass(tone: Tone) {
  return `badge ${tone}`;
}

function getRunState(run: Run | null, events: WatchtowerEvent[]): RunState {
  if (!run) return "idle";
  if (getCurrentDecision(events)) return "waiting_for_approval";
  if (run.status === "completed" || events.some((event) => event.type === "run_completed")) return "completed";
  if (run.status === "failed" || events.some((event) => event.type === "run_failed")) return "failed";
  return "running";
}

function getCurrentDecision(events: WatchtowerEvent[]) {
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

function getRouteNodes(events: WatchtowerEvent[], run: Run | null): RouteNode[] {
  if (hasSafetyIntervention(events)) {
    return getSafetyRouteNodes(events, run);
  }

  const pendingApproval = getCurrentDecision(events);
  const failed = run?.status === "failed" || events.some((event) => event.type === "run_failed" || isFailureEvent(event));
  const completed = run?.status === "completed" || events.some((event) => event.type === "run_completed");
  const started = events.some((event) => event.type === "run_started");
  const connected = events.some(
    (event) => event.type === "health_check_completed" || event.type === "mcp_server_connected"
  );
  const discovered = events.some(
    (event) =>
      event.type === "tools_discovered" ||
      event.type === "tool_discovered" ||
      event.type === "health_check_completed" ||
      event.type === "mcp_server_connected"
  );
  const requested = events.some((event) => event.type === "tool_call_requested" || event.type === "tool_call_auto_approved");
  const approvalSeen = events.some(isApprovalRequiredEvent);
  const approved = events.some((event) => event.type === "tool_call_approved");
  const rejected = events.some((event) => event.type === "tool_call_rejected");
  const executed = events.some(
    (event) => event.type === "tool_call_started" || event.type === "tool_call_completed"
  );

  const nodes: RouteNode[] = [
    {
      key: "start",
      label: "Started",
      status: statusFor(started, !started && !failed),
      icon: <CirclePlay size={18} />
    },
    {
      key: "connect",
      label: connectedServerLabel(events),
      status: failedBefore(events, "connect") ? "failed" : statusFor(connected, started && !connected && !failed),
      icon: <PlugZap size={18} />
    },
    {
      key: "discover",
      label: "Checked tools",
      status: statusFor(discovered, connected && !discovered && !failed),
      icon: <ListChecks size={18} />
    },
    {
      key: "request",
      label: requestedToolLabel(events),
      status: statusFor(requested, discovered && !requested && !failed),
      icon: <Wrench size={18} />
    },
    {
      key: "approval",
      label: "Approval required",
      status: pendingApproval ? "blocked" : rejected ? "failed" : statusFor(approvalSeen && (approved || completed), requested && approvalSeen && !approved && !failed),
      icon: pendingApproval ? <ShieldAlert size={18} /> : <ShieldCheck size={18} />
    },
    {
      key: "execute",
      label: "Tool ran",
      status: failed && executed ? "failed" : statusFor(executed, approved && !executed && !failed),
      icon: <Wrench size={18} />
    },
    {
      key: "finish",
      label: "Finish",
      status: failed ? "failed" : statusFor(completed, executed && !completed),
      icon: completed ? <Flag size={18} /> : <Circle size={18} />
    }
  ];

  return nodes;
}

function getSafetyRouteNodes(events: WatchtowerEvent[], run: Run | null): RouteNode[] {
  const pendingApproval = getCurrentDecision(events);
  const intervention = getIntervention(events);
  const failed = run?.status === "failed" || events.some((event) => event.type === "run_failed" || isFailureEvent(event));
  const completed = run?.status === "completed" || events.some((event) => event.type === "run_completed");
  const started = events.some((event) => event.type === "run_started");
  const healthChecked = events.some(
    (event) => event.type === "health_check_completed" || event.type === "mcp_server_connected"
  );
  const riskDetected = Boolean(
    intervention ||
      events.some(
        (event) =>
          event.type === "tool_call_requested" &&
          (event.metadata?.safety_action === "require_approval" || event.risk === "medium" || event.risk === "high")
      )
  );
  const approved = intervention ? Boolean(getApprovalDecision(events, intervention, "approved")) : false;
  const rejected = intervention ? Boolean(getApprovalDecision(events, intervention, "rejected")) : false;
  const requested = events.some((event) => event.type === "tool_call_requested");
  const forwarded = intervention
    ? events.some(
        (event) =>
          event.type === "tool_call_started" &&
          event.server === intervention.server &&
          event.tool === intervention.tool
      )
    : false;

  return [
    {
      key: "start",
      label: "Started",
      status: statusFor(started, !started && !failed),
      icon: <CirclePlay size={18} />
    },
    {
      key: "health",
      label: "Checked health",
      status: failedBefore(events, "connect") ? "failed" : statusFor(healthChecked, started && !healthChecked && !failed),
      icon: <PlugZap size={18} />
    },
    {
      key: "request",
      label: "Intercepted request",
      status: statusFor(requested, healthChecked && !requested && !failed),
      icon: <Wrench size={18} />
    },
    {
      key: "risk",
      label: detectedRiskLabel(intervention),
      status: statusFor(riskDetected, requested && !riskDetected && !failed),
      icon: <AlertTriangle size={18} />
    },
    {
      key: "paused",
      label: "Paused for approval",
      status: pendingApproval ? "blocked" : rejected ? "failed" : statusFor(Boolean(intervention), riskDetected && !intervention && !failed),
      icon: <ShieldAlert size={18} />,
      badge: "Watchtower intervened",
      keyMoment: true
    },
    {
      key: "forwarded",
      label: "Forwarded to MCP",
      status: failed && approved ? "failed" : statusFor(forwarded, approved && !forwarded && !failed),
      icon: <Wrench size={18} />
    },
    {
      key: "completed",
      label: "Completed",
      status: failed ? "failed" : statusFor(completed, forwarded && !completed),
      icon: completed ? <Flag size={18} /> : <Circle size={18} />
    }
  ];
}

function getTimelineSteps(events: WatchtowerEvent[]): JourneyStep[] {
  return events.map((event) => getStepDisplay(event, events));
}

function getTimelinePhases(steps: JourneyStep[]): TimelinePhase[] {
  const phaseMeta: Record<string, Omit<TimelinePhase, "items">> = {
    setup: {
      key: "setup",
      title: "Phase 1: Setup",
      description: "Watchtower prepared the tool connection before the agent used MCP.",
      tone: "active"
    },
    intervention: {
      key: "intervention",
      title: "Phase 2: Safety intervention",
      description: "Watchtower intercepted the risky request before it reached the MCP server.",
      tone: "warning"
    },
    execution: {
      key: "execution",
      title: "Phase 3: Approved execution",
      description: "After approval, Watchtower forwarded the request and tracked the MCP result.",
      tone: "success"
    },
    activity: {
      key: "activity",
      title: "Phase 2: Tool activity",
      description: "Watchtower observed the MCP tool request and result.",
      tone: "active"
    }
  };

  const phaseMap = new Map<string, TimelinePhase>();
  steps.forEach((step, index) => {
    const key = timelinePhaseKey(step);
    const meta = phaseMeta[key];
    if (!phaseMap.has(key)) {
      phaseMap.set(key, { ...meta, items: [] });
    }
    phaseMap.get(key)?.items.push({ step, number: index + 1 });
  });

  const hasIntervention = phaseMap.has("intervention");
  const order = hasIntervention ? ["setup", "intervention", "execution"] : ["setup", "activity", "execution"];
  return order.map((key) => phaseMap.get(key)).filter((phase): phase is TimelinePhase => Boolean(phase));
}

function timelinePhaseKey(step: JourneyStep) {
  if (
    step.event.type === "run_started" ||
    step.event.type === "mcp_server_check_started" ||
    step.event.type === "health_check_started" ||
    step.event.type === "mcp_server_connected" ||
    step.event.type === "health_check_completed" ||
    step.event.type === "tool_discovered" ||
    step.event.type === "tools_discovered"
  ) {
    return "setup";
  }

  if (
    step.title === "Agent requested a file write" ||
    step.title === "Watchtower detected risk" ||
    step.title === "Watchtower paused the tool call" ||
    isApprovalRequiredEvent(step.event)
  ) {
    return "intervention";
  }

  if (
    step.event.type === "tool_call_approved" ||
    step.event.type === "tool_call_rejected" ||
    step.event.type === "tool_call_started" ||
    step.event.type === "tool_call_completed" ||
    step.event.type === "tool_call_failed" ||
    step.event.type === "tool_call_timeout" ||
    step.event.type === "agent_step_completed" ||
    step.event.type === "run_completed" ||
    step.event.type === "run_failed"
  ) {
    return "execution";
  }

  return "activity";
}

function getStepDisplay(event: WatchtowerEvent, events: WatchtowerEvent[] = []): JourneyStep {
  if (event.type === "run_started") {
    return {
      event,
      title: "Agent started",
      explanation: "The agent received the task and opened a new run.",
      tone: "active",
      icon: <CirclePlay size={20} />
    };
  }
  if (event.type === "mcp_server_check_started" || event.type === "health_check_started") {
    return {
      event,
      title: event.server
        ? `Watchtower checked ${event.server} health`
        : "Watchtower checked tool health",
      explanation: `Before allowing tool use, Watchtower checked whether the ${event.server ?? "MCP"} server was reachable.`,
      tone: "active",
      icon: <PlugZap size={20} />
    };
  }
  if (event.type === "mcp_server_connected" || event.type === "health_check_completed") {
    const tools = numberValue(event.metadata?.tools_count ?? event.metadata?.toolsCount);
    return {
      event,
      title: event.server ? `${capitalize(event.server)} tools were available` : "MCP tools were available",
      explanation: `The MCP server was healthy${tools !== undefined ? ` and exposed ${tools} tools` : " and exposed its tools"}.`,
      tone: "success",
      icon: <Server size={20} />
    };
  }
  if (event.type === "mcp_server_failed" || event.type === "health_check_failed") {
    return {
      event,
      title: "MCP server failed",
      explanation: "The MCP server is unavailable or unhealthy.",
      tone: "danger",
      icon: <AlertTriangle size={20} />
    };
  }
  if (event.type === "tool_discovered" || event.type === "tools_discovered") {
    return {
      event,
      title: "Tools discovered",
      explanation: `Watchtower confirmed which actions ${event.server ?? "the MCP server"} can perform.`,
      tone: "success",
      icon: <ListChecks size={20} />
    };
  }
  if (event.type === "agent_step_started") {
    const intervention = getIntervention(events);
    return {
      event,
      title: intervention ? "Agent requested a file write" : "Agent prepared the next tool step",
      explanation: intervention
        ? `The agent asked to call ${displayTool(intervention)} for ${targetLabel(intervention)}.`
        : "The agent prepared the next MCP tool operation.",
      tone: "active",
      icon: <Wrench size={20} />
    };
  }
  if (event.type === "tool_call_requested" || event.type === "tool_call_auto_approved") {
    const isRisky = event.metadata?.safety_action === "require_approval" || event.risk === "medium" || event.risk === "high";
    return {
      event,
      title: isRisky ? "Watchtower detected risk" : `Agent requested ${displayTool(event)}`,
      explanation: isRisky
        ? `${displayTool(event)} can modify external state, so Watchtower classified it as a risky action.`
        : `The agent asked to call ${displayTool(event)} and Watchtower recorded the request.`,
      tone: isRisky ? "warning" : "active",
      icon: isRisky ? <AlertTriangle size={20} /> : <Wrench size={20} />,
      badge: isRisky ? "Key intervention" : undefined
    };
  }
  if (isApprovalRequiredEvent(event)) {
    return {
      event,
      title: "Watchtower paused the tool call",
      explanation:
        "The MCP tool has not executed yet. Watchtower is holding the request until a human approves or rejects it.",
      tone: "warning",
      icon: <ShieldAlert size={20} />,
      badge: "Key intervention"
    };
  }
  if (event.type === "tool_call_approved") {
    return {
      event,
      title: "Human approved the request",
      explanation: "After approval, Watchtower released the tool call to the MCP server.",
      tone: "success",
      icon: <CheckCircle2 size={20} />
    };
  }
  if (event.type === "tool_call_rejected") {
    return {
      event,
      title: "Action rejected",
      explanation: "The human rejected this tool call and the run stopped.",
      tone: "danger",
      icon: <XCircle size={20} />
    };
  }
  if (event.type === "tool_call_started") {
    const intervention = getMatchingIntervention(events, event);
    return {
      event,
      title: intervention ? "Watchtower forwarded the call to MCP" : "Tool execution started",
      explanation: intervention
        ? `The approved ${displayTool(event)} request was sent to the ${event.server ?? "MCP"} server.`
        : `${displayTool(event)} ran after Watchtower allowed the MCP tool call to proceed.`,
      tone: "active",
      icon: <Wrench size={20} />
    };
  }
  if (event.type === "tool_call_completed") {
    const intervention = getMatchingIntervention(events, event);
    return {
      event,
      title: intervention
        ? "MCP tool executed successfully"
        : "Tool completed",
      explanation: intervention
        ? `The ${event.server ?? "MCP"} server completed the approved ${event.tool ?? "tool"} request.`
        : "The tool returned a result successfully.",
      tone: "success",
      icon: <CheckCircle2 size={20} />
    };
  }
  if (event.type === "tool_call_failed" || event.type === "tool_call_timeout") {
    return {
      event,
      title: "Tool failed",
      explanation: "The tool call failed. Inspect the error details.",
      tone: "danger",
      icon: <AlertTriangle size={20} />
    };
  }
  if (event.type === "run_completed") {
    const intervention = getIntervention(events);
    return {
      event,
      title: intervention ? "Run completed safely" : "Run completed",
      explanation: intervention
        ? "The run finished after the risky action was approved and executed."
        : "The agent finished the journey.",
      tone: "success",
      icon: <Flag size={20} />
    };
  }
  if (event.type === "agent_step_completed") {
    return {
      event,
      title: "Agent received the result",
      explanation: "The agent received the approved tool output and continued.",
      tone: "success",
      icon: <CheckCircle2 size={20} />
    };
  }
  if (event.type === "run_failed") {
    return {
      event,
      title: "Run failed",
      explanation: "The run stopped before the agent finished.",
      tone: "danger",
      icon: <AlertTriangle size={20} />
    };
  }
  return {
    event,
    title: event.message || "Agent step observed",
    explanation: "Watchtower recorded this step as evidence in the agent's tool journey.",
    tone: getStatusTone(event.status),
    icon: <Clock3 size={20} />
  };
}

function statusFor(done: boolean, current: boolean): RouteStatus {
  if (done) return "completed";
  if (current) return "current";
  return "future";
}

function failedBefore(events: WatchtowerEvent[], stage: "connect") {
  if (stage === "connect") {
    return events.some((event) => event.type === "health_check_failed" || event.type === "mcp_server_failed");
  }
  return false;
}

function connectedServerLabel(events: WatchtowerEvent[]) {
  const event = events.find(
    (item) => item.type === "health_check_completed" || item.type === "mcp_server_connected"
  );
  return event?.server ? `Connect ${event.server}` : "Connect server";
}

function requestedToolLabel(events: WatchtowerEvent[]) {
  const approval = events.find(isApprovalRequiredEvent);
  const requested = approval ?? events.find((event) => event.type === "tool_call_requested");
  return requested?.tool ? `Request ${requested.tool}` : "Request tool";
}

function hasSafetyIntervention(events: WatchtowerEvent[]) {
  return Boolean(getIntervention(events));
}

function getIntervention(events: WatchtowerEvent[]) {
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
      ((intervention.approval_id && event.approval_id === intervention.approval_id) ||
        (event.server === intervention.server && event.tool === intervention.tool))
  );
}

function getCompletedToolEvent(events: WatchtowerEvent[], intervention: WatchtowerEvent) {
  return events.find(
    (event) =>
      event.type === "tool_call_completed" &&
      event.server === intervention.server &&
      event.tool === intervention.tool
  );
}

function getMatchingIntervention(events: WatchtowerEvent[], event: WatchtowerEvent) {
  return events.find(
    (candidate) =>
      isApprovalRequiredEvent(candidate) &&
      candidate.server === event.server &&
      candidate.tool === event.tool
  );
}

function serverWasHealthy(events: WatchtowerEvent[], server?: string) {
  return events.some(
    (event) =>
      (event.type === "health_check_completed" || event.type === "mcp_server_connected") &&
      (!server || event.server === server)
  );
}

function detectedRiskLabel(intervention?: WatchtowerEvent) {
  if (intervention?.tool?.includes("write")) return "Detected risk";
  if (intervention?.tool) return `Detected risky ${intervention.tool}`;
  return "Detected risky action";
}

function isApprovalRequiredEvent(event: WatchtowerEvent) {
  return event.type === "approval_required" || event.type === "tool_call_approval_required";
}

function isHealthEvent(event: WatchtowerEvent) {
  return (
    event.type.startsWith("health_check") ||
    event.type === "mcp_server_check_started" ||
    event.type === "mcp_server_connected" ||
    event.type === "mcp_server_failed"
  );
}

function isFailureEvent(event: WatchtowerEvent) {
  return (
    event.type === "tool_call_failed" ||
    event.type === "tool_call_timeout" ||
    event.type === "health_check_failed" ||
    event.type === "mcp_server_failed" ||
    event.type === "run_failed"
  );
}

function displayTool(event: WatchtowerEvent) {
  return [event.server, event.tool].filter(Boolean).join(".") || "MCP tool";
}

function describeAction(event: WatchtowerEvent) {
  const target = targetLabel(event);
  if (event.tool?.includes("write")) return `write ${target}`;
  if (event.tool?.includes("delete")) return `delete ${target}`;
  if (event.tool?.includes("send")) return `send data${target !== "the selected target" ? ` to ${target}` : ""}`;
  if (event.tool?.includes("create")) return `create ${target}`;
  return `call ${displayTool(event)}`;
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

function summarizeInput(event: WatchtowerEvent) {
  const input = asRecord(event.input);
  const path = stringValue(input?.path);
  const title = stringValue(input?.title);
  const to = stringValue(input?.to);
  const subject = stringValue(input?.subject);
  if (path && event.tool?.includes("write")) return `Writes ${path}`;
  if (path) return `Uses ${path}`;
  if (title && event.tool?.includes("create")) return `Creates "${title}"`;
  if (to && event.tool?.includes("send")) return `Sends ${subject ? `"${subject}" ` : ""}to ${to}`;
  return `Sends the shown input to ${displayTool(event)}`;
}

function outcomeSummary(event: WatchtowerEvent) {
  if (isApprovalRequiredEvent(event)) {
    return "Watchtower paused this step because it could modify external state.";
  }
  if (event.type === "tool_call_approved") {
    return "A human approved the risky action before the tool could run.";
  }
  if (event.type === "tool_call_completed") return "The MCP tool returned successfully.";
  if (isFailureEvent(event)) return "Watchtower captured the failure so it can be inspected.";
  return "This step is evidence in the agent's MCP journey.";
}

function executionSummary(event: WatchtowerEvent) {
  if (event.type === "tool_call_completed") return "Completed safely";
  if (event.type === "tool_call_started") return "Running";
  if (isApprovalRequiredEvent(event)) return "Paused before execution";
  if (event.type === "tool_call_approved") return "Approved by human";
  if (event.type === "tool_call_rejected") return "Rejected by human";
  if (isFailureEvent(event)) return "Failed";
  return prettyStatus(event.status);
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

function formatError(value: unknown) {
  if (!value) return undefined;
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function formatDuration(start?: string | null, end?: string | null) {
  if (!start) return "Not available";
  const startTime = new Date(start).getTime();
  const endTime = end ? new Date(end).getTime() : Date.now();
  if (Number.isNaN(startTime) || Number.isNaN(endTime)) return "Not available";
  const seconds = Math.max(0, Math.round((endTime - startTime) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

function runScenario(run: Run) {
  if (run.app_name === "fake-agent-demo") {
    return {
      name: "Live Journey Demo",
      description: "Shows an agent calling MCP tools step-by-step."
    };
  }
  if (run.app_name === "safety-gate-demo") {
    return {
      name: "Safety Gate Demo",
      description: "Shows a risky tool call waiting for approval."
    };
  }
  if (run.app_name === "toy-mcp-real-test") {
    return {
      name: "User MCP Server Test",
      description: "Shows a wrapped user-owned MCP server being observed."
    };
  }
  return {
    name: run.app_name,
    description: run.task ?? "Observed run from a wrapped MCP client."
  };
}

function getHealthTone(item: Health): Tone {
  if (item.status === "healthy" && (item.latency_ms ?? 0) < 1000) return "success";
  if (item.status === "healthy") return "warning";
  if (item.status === "timeout" || item.status === "unhealthy" || item.status === "failed") {
    return "danger";
  }
  return "neutral";
}

function getStatusTone(status: string): Tone {
  if (status === "completed" || status === "healthy" || status === "approved") return "success";
  if (status === "waiting" || status === "pending" || status === "waiting_for_approval") {
    return "warning";
  }
  if (status === "failed" || status === "rejected" || status === "timeout") return "danger";
  if (status === "running") return "active";
  return "neutral";
}

function getRunStateTone(state: RunState): Tone {
  if (state === "completed") return "success";
  if (state === "waiting_for_approval") return "warning";
  if (state === "failed") return "danger";
  if (state === "running") return "active";
  return "neutral";
}

function getRiskTone(risk: string): Tone {
  if (risk === "low") return "success";
  if (risk === "medium") return "warning";
  if (risk === "high" || risk === "critical") return "danger";
  return "neutral";
}

function prettyStatus(status: string) {
  return status.replaceAll("_", " ");
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function timeOnly(timestamp: string) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function upsertRun(runs: Run[], nextRun: Run) {
  if (runs.some((run) => run.run_id === nextRun.run_id)) {
    return runs.map((run) => (run.run_id === nextRun.run_id ? nextRun : run));
  }
  return [nextRun, ...runs];
}
