import { CheckSquare, ShieldAlert } from "lucide-react";
import { useMemo } from "react";
import { MetricCard } from "../components/MetricCard";
import { formatLatency } from "../lib/eventUtils";
import type { Approval, Health, Run, ToolReliability, WatchtowerEvent } from "../types";

type MissionControlPageProps = {
  runs: Run[];
  health: Health[];
  approvals: Approval[];
  reliability: ToolReliability[];
  recentEvents: WatchtowerEvent[];
  approvalBusy: string | null;
  onDecision: (approvalId: string, decision: "approve" | "reject") => Promise<void>;
  onViewApprovals: () => void;
  onOpenRun: (run: Run) => void;
};

export function MissionControlPage({
  runs,
  health,
  approvals,
  reliability,
  recentEvents,
  approvalBusy,
  onDecision,
  onViewApprovals,
  onOpenRun,
}: MissionControlPageProps) {
  const activeRuns = runs.filter((r) => r.status === "running");
  const pendingApprovals = approvals.filter((a) => a.status === "waiting");

  const { successRate, sparkPoints } = useMemo(() => {
    const total = reliability.reduce((s, r) => s + r.success_count + r.failure_count + r.timeout_count, 0);
    const success = reliability.reduce((s, r) => s + r.success_count, 0);
    const rate = total === 0 ? 100 : Math.round((success / total) * 100);

    // Bucket the last 20 tool-call events into a mini sparkline
    const toolEvents = recentEvents
      .filter((e) => e.type === "tool_call_completed" || e.type === "tool_call_failed")
      .slice(-20);
    const points = toolEvents.length < 2
      ? [rate, rate]
      : toolEvents.map((e) => (e.type === "tool_call_completed" ? 100 : 0));

    return { successRate: rate, sparkPoints: points };
  }, [reliability, recentEvents]);

  const toolCallsPerMin = useMemo(() => {
    const cutoff = Date.now() - 60_000;
    return recentEvents.filter(
      (e) =>
        e.type === "tool_call_completed" &&
        new Date(e.timestamp).getTime() > cutoff,
    ).length;
  }, [recentEvents]);

  const healthOk = health.filter((h) => h.status === "healthy").length;

  return (
    <div className="pageContent">
      <div className="pageHeader">
        <div>
          <h2>Mission Control</h2>
          <p>Live overview of all agent activity</p>
        </div>
      </div>

      {/* KPI tiles */}
      <div className="metricGrid">
        <MetricCard
          label="Active runs"
          value={activeRuns.length}
          sub={`${runs.length} total`}
          tone={activeRuns.length > 0 ? "teal" : "default"}
        />
        <MetricCard
          label="Pending approvals"
          value={pendingApprovals.length}
          alert={pendingApprovals.length > 0 ? "Action required" : undefined}
          sub="all clear"
          tone={pendingApprovals.length > 0 ? "rose" : "default"}
        />
        <MetricCard
          label="Tool calls / min"
          value={toolCallsPerMin}
          sub="last 60 seconds"
        />
        <MetricCard
          label="Success rate (all time)"
          value={`${successRate}%`}
          sub={`${healthOk}/${health.length} servers healthy`}
          tone={successRate >= 95 ? "teal" : successRate >= 80 ? "amber" : "rose"}
          sparkPoints={sparkPoints}
        />
      </div>

      {/* Pending approval queue */}
      <div className="mcSection">
        <div className="mcSectionHeader">
          <div className="mcSectionTitle">
            <ShieldAlert size={15} style={{ color: "var(--rose)" }} />
            <h3>Awaiting your decision ({pendingApprovals.length})</h3>
          </div>
          {pendingApprovals.length > 0 && (
            <button className="mcSectionLink" type="button" onClick={onViewApprovals}>
              View all →
            </button>
          )}
        </div>

        <div className="approvalQueue">
          {pendingApprovals.length === 0 ? (
            <div className="approvalQueueEmpty">
              <CheckSquare size={15} />
              No pending approvals — all clear.
            </div>
          ) : (
            pendingApprovals.slice(0, 3).map((appr) => (
              <ApprovalCard
                key={appr.approval_id}
                approval={appr}
                busy={approvalBusy === appr.approval_id}
                onDecision={onDecision}
              />
            ))
          )}
        </div>
      </div>

      {/* Live activity feed */}
      <div className="mcSection">
        <div className="mcSectionHeader">
          <div className="mcSectionTitle">
            <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>Live activity</span>
          </div>
          <span style={{ color: "var(--text-faint)", fontSize: "11px" }}>
            {recentEvents.length} recent events
          </span>
        </div>

        <div className="activityFeed">
          {recentEvents.length === 0 ? (
            <div className="approvalQueueEmpty">No recent events — start a run to see activity.</div>
          ) : (
            [...recentEvents].reverse().slice(0, 25).map((event) => (
              <ActivityRow
                key={event.event_id}
                event={event}
                run={runs.find((r) => r.run_id === event.run_id)}
                onOpenRun={onOpenRun}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function ApprovalCard({
  approval,
  busy,
  onDecision,
}: {
  approval: Approval;
  busy: boolean;
  onDecision: (id: string, decision: "approve" | "reject") => Promise<void>;
}) {
  const age = timeAgo(approval.created_at);
  const tool = approval.reason?.match(/tool[:\s]+(\S+)/i)?.[1] ?? approval.approval_id.slice(0, 8);

  return (
    <div className="approvalCard">
      <div className="approvalCardTop">
        <div className="approvalCardMeta">
          <span className="approvalCardTitle">{tool}</span>
          <span className="approvalCardSub">
            Run: {approval.run_id.slice(0, 12)}…
            {approval.risk ? ` · Risk: ${approval.risk}` : ""}
          </span>
        </div>
        <span className="approvalCardAge">{age}</span>
      </div>
      {approval.reason ? (
        <div className="approvalCardArgs">{approval.reason}</div>
      ) : null}
      <div className="approvalCardActions">
        <button
          className="approveButton"
          type="button"
          disabled={busy}
          style={{ height: 30, fontSize: 12, padding: "0 12px" }}
          onClick={() => void onDecision(approval.approval_id, "approve")}
        >
          Approve
        </button>
        <button
          className="rejectButton"
          type="button"
          disabled={busy}
          style={{ height: 30, fontSize: 12, padding: "0 12px" }}
          onClick={() => void onDecision(approval.approval_id, "reject")}
        >
          Reject
        </button>
      </div>
    </div>
  );
}

function ActivityRow({
  event,
  run,
  onOpenRun,
}: {
  event: WatchtowerEvent;
  run?: Run;
  onOpenRun: (run: Run) => void;
}) {
  const tone = eventTone(event.type);
  const ts = event.timestamp.slice(11, 19);
  const tool = event.server && event.tool
    ? `${event.server}.${event.tool}`
    : event.tool ?? event.type;

  return (
    <div className="activityRow">
      <span className="activityTime">{ts}</span>
      <span className={`activityStatusDot ${tone}`} />
      <span className="activityTool">{tool}</span>
      <span className="activityLatency">{formatLatency(event.latency_ms)}</span>
      <button
        className="activityRun"
        type="button"
        style={{ background: "none", border: "none", cursor: run ? "pointer" : "default", padding: 0, textAlign: "left" }}
        onClick={() => run && onOpenRun(run)}
        title={event.run_id}
      >
        {event.run_id.slice(0, 10)}…
      </button>
    </div>
  );
}

function eventTone(type: string): string {
  if (type === "tool_call_completed" || type === "run_completed") return "success";
  if (type === "tool_call_failed" || type === "run_failed") return "danger";
  if (type === "approval_required") return "warning";
  if (type === "tool_call_started" || type === "run_started") return "active";
  return "neutral";
}

function timeAgo(iso: string): string {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
}
