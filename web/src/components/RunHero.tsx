import {
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  FileWarning,
  PauseCircle,
  ShieldAlert,
  ShieldCheck,
  XCircle
} from "lucide-react";
import type { ReactNode } from "react";
import type { Health, PrimaryToolCall, Run, RunMode, Tone, WatchtowerEvent } from "../types";
import {
  formatDuration,
  formatToolName,
  getOutcomeSummary,
  getRiskTone,
  prettyStatus
} from "../lib/eventUtils";
import { StatusBadge } from "./StatusBadge";

type RunHeroProps = {
  run: Run;
  events: WatchtowerEvent[];
  health: Health[];
  mode: RunMode;
  pendingApproval?: WatchtowerEvent;
  primaryToolCall: PrimaryToolCall;
  approvalBusy: string | null;
  onDecision: (approvalId: string, decision: "approve" | "reject") => Promise<void>;
};

export function RunHero({
  run,
  events,
  health,
  mode,
  pendingApproval,
  primaryToolCall,
  approvalBusy,
  onDecision
}: RunHeroProps) {
  const summary = getOutcomeSummary(run, events, health);
  const latest = events.at(-1);

  if (mode === "waiting_for_approval" && pendingApproval?.approval_id) {
    return (
      <section className="runHero approval">
        <HeroIcon tone="warning">
          <ShieldAlert size={28} />
        </HeroIcon>
        <div className="heroBody">
          <div className="heroTitleRow">
            <p className="eyebrow">Safety gate active</p>
            <StatusBadge tone="warning">MCP call paused</StatusBadge>
          </div>
          <h2>Human approval required</h2>
          <p className="heroLead">
            {primaryToolCall.fullName} wants to {primaryToolCall.action}. Watchtower paused the MCP call before
            execution.
          </p>

          <dl className="heroFacts">
            <Fact label="Tool" value={primaryToolCall.tool} />
            <Fact label="Server" value={primaryToolCall.server} />
            <Fact label="Risk level" value={prettyStatus(primaryToolCall.risk)} tone={getRiskTone(primaryToolCall.risk)} />
            <Fact label="Target" value={primaryToolCall.target} />
            <Fact label="Reason" value={primaryToolCall.reason} wide />
          </dl>

          <div className="heroActions">
            <button
              className="approveButton"
              type="button"
              disabled={approvalBusy === pendingApproval.approval_id}
              onClick={() => void onDecision(pendingApproval.approval_id!, "approve")}
            >
              <ShieldCheck size={17} />
              Approve and Forward
            </button>
            <button
              className="rejectButton"
              type="button"
              disabled={approvalBusy === pendingApproval.approval_id}
              onClick={() => void onDecision(pendingApproval.approval_id!, "reject")}
            >
              <XCircle size={17} />
              Reject and Block
            </button>
          </div>
        </div>
      </section>
    );
  }

  if (mode === "completed") {
    return (
      <section className="runHero success">
        <HeroIcon tone="success">
          <CheckCircle2 size={28} />
        </HeroIcon>
        <div className="heroBody">
          <div className="heroTitleRow">
            <p className="eyebrow">Flight recorder closed</p>
            <StatusBadge tone="success">Completed</StatusBadge>
          </div>
          <h2>Run completed</h2>
          <p className="heroLead">
            {primaryToolCall.decision === "approved"
              ? "Watchtower approved, forwarded, and recorded the MCP tool result."
              : "Watchtower recorded the MCP execution path and audit trail."}
          </p>
          <dl className="heroFacts compact">
            <Fact label="Tool" value={formatToolName(primaryToolCall)} />
            <Fact label="Duration" value={summary.duration} />
            <Fact label="Events" value={String(summary.totalEvents)} />
            <Fact label="Risky actions reviewed" value={String(summary.reviewed)} />
          </dl>
        </div>
      </section>
    );
  }

  if (mode === "rejected" || mode === "blocked") {
    return (
      <section className="runHero danger">
        <HeroIcon tone="danger">
          <FileWarning size={28} />
        </HeroIcon>
        <div className="heroBody">
          <div className="heroTitleRow">
            <p className="eyebrow">Safety gate closed</p>
            <StatusBadge tone="danger">{mode === "blocked" ? "Blocked" : "Rejected"}</StatusBadge>
          </div>
          <h2>{mode === "blocked" ? "Policy blocked the tool call" : "Tool rejected and blocked"}</h2>
          <p className="heroLead">
            Watchtower stopped {primaryToolCall.fullName} before the MCP server could execute the request.
          </p>
          <dl className="heroFacts compact">
            <Fact label="Tool" value={primaryToolCall.fullName} />
            <Fact label="Target" value={primaryToolCall.target} />
            <Fact label="Reason" value={primaryToolCall.reason} wide />
          </dl>
        </div>
      </section>
    );
  }

  if (mode === "failed") {
    return (
      <section className="runHero danger">
        <HeroIcon tone="danger">
          <AlertTriangle size={28} />
        </HeroIcon>
        <div className="heroBody">
          <div className="heroTitleRow">
            <p className="eyebrow">Execution stopped</p>
            <StatusBadge tone="danger">Failed</StatusBadge>
          </div>
          <h2>Run failed</h2>
          <p className="heroLead">{latest?.message ?? "The MCP run stopped before completion."}</p>
          <dl className="heroFacts compact">
            <Fact label="Tool" value={primaryToolCall.fullName} />
            <Fact label="Last event" value={latest ? prettyStatus(latest.type) : "n/a"} />
            <Fact label="Duration" value={formatDuration(run.started_at, latest?.timestamp)} />
          </dl>
        </div>
      </section>
    );
  }

  return (
    <section className="runHero active">
      <HeroIcon tone="active">
        <CircleDot size={28} />
      </HeroIcon>
      <div className="heroBody">
        <div className="heroTitleRow">
          <p className="eyebrow">Live execution</p>
          <StatusBadge tone="active">Running</StatusBadge>
        </div>
        <h2>Agent execution in progress</h2>
        <p className="heroLead">
          Watchtower is intercepting MCP activity and recording each policy, server, and tool event.
        </p>
        <dl className="heroFacts compact">
          <Fact label="Current tool" value={primaryToolCall.fullName} />
          <Fact label="Server" value={primaryToolCall.server} />
          <Fact label="Run age" value={formatDuration(run.started_at, latest?.timestamp)} />
          <Fact label="Latest event" value={latest ? prettyStatus(latest.type) : "Waiting"} />
        </dl>
      </div>
    </section>
  );
}

function HeroIcon({ children, tone }: { children: ReactNode; tone: "active" | "warning" | "success" | "danger" }) {
  return <div className={`heroIcon ${tone}`}>{children}</div>;
}

function Fact({ label, value, tone, wide }: { label: string; value: string; tone?: Tone; wide?: boolean }) {
  return (
    <div className={wide ? "wideFact" : undefined}>
      <dt>{label}</dt>
      <dd>{tone ? <StatusBadge tone={tone}>{value}</StatusBadge> : value}</dd>
    </div>
  );
}
