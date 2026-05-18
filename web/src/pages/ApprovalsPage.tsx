import { CheckCircle, Clock, ShieldAlert, XCircle } from "lucide-react";
import { useState } from "react";
import { StatusBadge } from "../components/StatusBadge";
import { getRiskTone } from "../lib/eventUtils";
import type { Approval } from "../types";

type ApprovalsPageProps = {
  approvals: Approval[];
  approvalBusy: string | null;
  onDecision: (approvalId: string, decision: "approve" | "reject") => Promise<void>;
  onRefresh: () => void;
};

type Tab = "pending" | "history";

export function ApprovalsPage({ approvals, approvalBusy, onDecision, onRefresh }: ApprovalsPageProps) {
  const [tab, setTab] = useState<Tab>("pending");

  const pending = approvals.filter((a) => a.status === "waiting");
  const history = approvals.filter((a) => a.status !== "waiting");

  return (
    <div className="pageContent">
      <div className="pageHeader">
        <div>
          <h2>Approvals</h2>
          <p>Review and decide on gated tool calls</p>
        </div>
        <button className="secondaryButton" type="button" onClick={onRefresh}>
          Refresh
        </button>
      </div>

      <div className="mcSection">
        <div className="tabBar">
          <button
            className={`tabBtn ${tab === "pending" ? "active" : ""}`}
            type="button"
            onClick={() => setTab("pending")}
          >
            Pending
            {pending.length > 0 && (
              <span style={{ marginLeft: 6, background: "var(--rose)", borderRadius: 999, color: "#fff", fontSize: 10, fontWeight: 700, padding: "1px 6px" }}>
                {pending.length}
              </span>
            )}
          </button>
          <button
            className={`tabBtn ${tab === "history" ? "active" : ""}`}
            type="button"
            onClick={() => setTab("history")}
          >
            History ({history.length})
          </button>
        </div>

        {tab === "pending" ? (
          <PendingTab
            approvals={pending}
            approvalBusy={approvalBusy}
            onDecision={onDecision}
          />
        ) : (
          <HistoryTab approvals={history} />
        )}
      </div>
    </div>
  );
}

function PendingTab({
  approvals,
  approvalBusy,
  onDecision,
}: {
  approvals: Approval[];
  approvalBusy: string | null;
  onDecision: (id: string, decision: "approve" | "reject") => Promise<void>;
}) {
  if (approvals.length === 0) {
    return (
      <div className="approvalQueueEmpty" style={{ padding: "32px 16px" }}>
        <CheckCircle size={18} style={{ color: "var(--success)" }} />
        No pending approvals — all tool calls are flowing freely.
      </div>
    );
  }

  return (
    <div className="approvalQueue">
      {approvals.map((appr) => (
        <PendingCard
          key={appr.approval_id}
          approval={appr}
          busy={approvalBusy === appr.approval_id}
          onDecision={onDecision}
        />
      ))}
    </div>
  );
}

function PendingCard({
  approval,
  busy,
  onDecision,
}: {
  approval: Approval;
  busy: boolean;
  onDecision: (id: string, decision: "approve" | "reject") => Promise<void>;
}) {
  const age = timeAgo(approval.created_at);

  return (
    <div className="approvalCard">
      <div className="approvalCardTop">
        <div className="approvalCardMeta">
          <span className="approvalCardTitle">
            <ShieldAlert size={13} style={{ color: "var(--rose)", verticalAlign: "middle", marginRight: 6 }} />
            {approval.approval_id}
          </span>
          <span className="approvalCardSub">
            Run: {approval.run_id}
            {approval.risk ? (
              <>
                {" · "}
                <StatusBadge tone={getRiskTone(approval.risk)}>{approval.risk}</StatusBadge>
              </>
            ) : null}
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
          onClick={() => void onDecision(approval.approval_id, "approve")}
        >
          <CheckCircle size={14} />
          Approve <kbd style={{ opacity: 0.6, fontSize: 11 }}>A</kbd>
        </button>
        <button
          className="rejectButton"
          type="button"
          disabled={busy}
          onClick={() => void onDecision(approval.approval_id, "reject")}
        >
          <XCircle size={14} />
          Reject <kbd style={{ opacity: 0.6, fontSize: 11 }}>R</kbd>
        </button>
        <span className="approvalLinkBtn" style={{ color: "var(--text-faint)", fontSize: 12, marginLeft: "auto" }}>
          run: {approval.run_id.slice(0, 12)}…
        </span>
      </div>
    </div>
  );
}

function HistoryTab({ approvals }: { approvals: Approval[] }) {
  if (approvals.length === 0) {
    return (
      <div className="approvalQueueEmpty" style={{ padding: "32px 16px" }}>
        <Clock size={18} />
        No approval history yet.
      </div>
    );
  }

  return (
    <div className="approvalHistoryTable">
      <div className="approvalHistoryRow heading">
        <span>Approval ID</span>
        <span>Risk</span>
        <span>Decision</span>
        <span>Run</span>
        <span>Decided</span>
      </div>
      {approvals.map((appr) => (
        <div className="approvalHistoryRow" key={appr.approval_id}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {appr.approval_id}
          </span>
          <span>
            {appr.risk ? (
              <StatusBadge tone={getRiskTone(appr.risk)}>{appr.risk}</StatusBadge>
            ) : (
              <span style={{ color: "var(--text-faint)" }}>—</span>
            )}
          </span>
          <span>
            <DecisionChip decision={appr.decision} />
          </span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {appr.run_id.slice(0, 10)}…
          </span>
          <span style={{ color: "var(--text-faint)", fontSize: 11 }}>
            {appr.decided_at ? timeAgo(appr.decided_at) : "—"}
          </span>
        </div>
      ))}
    </div>
  );
}

function DecisionChip({ decision }: { decision?: string | null }) {
  if (decision === "approved") {
    return <StatusBadge tone="success">Approved</StatusBadge>;
  }
  if (decision === "rejected") {
    return <StatusBadge tone="danger">Rejected</StatusBadge>;
  }
  return <StatusBadge tone="neutral">—</StatusBadge>;
}

function timeAgo(iso: string): string {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}
