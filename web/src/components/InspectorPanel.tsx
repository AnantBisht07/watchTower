import { Activity, ClipboardList, Database, FileJson, ShieldAlert, Wrench } from "lucide-react";
import type { ReactNode } from "react";
import type { Health, PrimaryToolCall, Run, RunMode, WatchtowerEvent } from "../types";
import {
  formatDateTime,
  formatDuration,
  formatError,
  formatJson,
  formatLatency,
  formatToolName,
  getHealthTone,
  getOutcomeSummary,
  getRiskTone,
  getTimelineItem,
  prettyStatus,
  summarizeInput,
  targetLabel
} from "../lib/eventUtils";
import { StatusBadge } from "./StatusBadge";

type InspectorPanelProps = {
  run: Run | null;
  events: WatchtowerEvent[];
  health: Health[];
  mode: RunMode;
  selectedEvent: WatchtowerEvent | null;
  pendingApproval?: WatchtowerEvent;
  primaryToolCall: PrimaryToolCall;
  approvalBusy: string | null;
  onDecision: (approvalId: string, decision: "approve" | "reject") => Promise<void>;
};

export function InspectorPanel({
  run,
  events,
  health,
  mode,
  selectedEvent,
  pendingApproval,
  primaryToolCall,
  approvalBusy,
  onDecision
}: InspectorPanelProps) {
  const focus = selectedEvent ?? pendingApproval ?? primaryToolCall.event ?? events.at(-1) ?? null;
  const summary = getOutcomeSummary(run, events, health);

  return (
    <aside className="inspectorPanel">
      <div className="inspectorHeader">
        <div>
          <p className="eyebrow">Inspector</p>
          <h2>{pendingApproval ? "Approval Gate" : focus ? "Event Details" : "Run Context"}</h2>
        </div>
        <StatusBadge tone={modeTone(mode)}>{prettyStatus(mode)}</StatusBadge>
      </div>

      {pendingApproval?.approval_id ? (
        <section className="inspectorBlock approvalBlock">
          <BlockTitle icon={<ShieldAlert size={17} />} title="Human review" />
          <dl className="detailList">
            <Detail label="Tool" value={formatToolName(pendingApproval)} />
            <Detail label="Server" value={pendingApproval.server ?? "MCP server"}/>
            <Detail label="Risk" value={<StatusBadge tone={getRiskTone(pendingApproval.risk)}>{pendingApproval.risk ?? "unknown"}</StatusBadge>} />
            <Detail label="Target" value={targetLabel(pendingApproval)} />
            <Detail label="Reason" value={pendingApproval.reason ?? "Policy requires approval"} />
          </dl>
          <div className="decisionExplainer">
            <div>
              <strong>If approved</strong>
              <p>Watchtower will forward this request to the MCP server and record the result.</p>
            </div>
            <div>
              <strong>If rejected</strong>
              <p>Watchtower will block the tool call and keep the audit trail.</p>
            </div>
          </div>
          <Preview title="Input preview" value={pendingApproval.input} />
          <details className="rawDetails">
            <summary>
              <FileJson size={15} />
              Raw event JSON
            </summary>
            <pre>{formatJson(pendingApproval)}</pre>
          </details>
          <div className="decisionActions">
            <button
              className="approveButton"
              type="button"
              disabled={approvalBusy === pendingApproval.approval_id}
              onClick={() => void onDecision(pendingApproval.approval_id!, "approve")}
            >
              Approve and Forward
            </button>
            <button
              className="rejectButton"
              type="button"
              disabled={approvalBusy === pendingApproval.approval_id}
              onClick={() => void onDecision(pendingApproval.approval_id!, "reject")}
            >
              Reject and Block
            </button>
          </div>
        </section>
      ) : null}

      {!pendingApproval && focus ? <EventInspector event={focus} events={events} /> : null}

      {!pendingApproval && !focus ? (
        <section className="inspectorBlock">
          <BlockTitle icon={<ClipboardList size={17} />} title="No event selected" />
          <p className="mutedText">Select an audit row to inspect event payloads and tool details.</p>
        </section>
      ) : null}

      <section className="inspectorBlock">
        <BlockTitle icon={<Wrench size={17} />} title={mode === "completed" ? "Outcome summary" : "Current tool call"} />
        <dl className="detailList">
          <Detail label="Tool" value={primaryToolCall.fullName} />
          <Detail label="Target" value={primaryToolCall.target} />
          <Detail label="Execution" value={primaryToolCall.hasExecuted ? "Forwarded to MCP" : "Not executed yet"} />
          <Detail label="Events" value={String(summary.totalEvents)} />
          <Detail label="Risky reviewed" value={String(summary.reviewed)} />
          <Detail label="Duration" value={summary.duration} />
        </dl>
      </section>

      <section className="inspectorBlock">
        <BlockTitle icon={<Activity size={17} />} title="Server health" />
        <div className="inspectorHealth">
          {health.length === 0 ? (
            <p className="mutedText">No server health checks yet.</p>
          ) : (
            health.map((item) => (
              <div className="inspectorHealthRow" key={item.server}>
                <span className={`healthDot ${getHealthTone(item)}`} />
                <span>
                  <strong>{item.server}</strong>
                  <small>
                    {prettyStatus(item.status)} / {item.tools_count} tools / {formatLatency(item.latency_ms)}
                  </small>
                </span>
              </div>
            ))
          )}
        </div>
      </section>
    </aside>
  );
}

function EventInspector({ event, events }: { event: WatchtowerEvent; events: WatchtowerEvent[] }) {
  const item = getTimelineItem(event, events);
  return (
    <section className={`inspectorBlock eventBlock ${item.tone}`}>
      <BlockTitle icon={<Database size={17} />} title={item.title} />
      <p className="eventMessage">{item.message}</p>
      <dl className="detailList">
        <Detail label="Type" value={prettyStatus(event.type)} />
        <Detail label="Status" value={<StatusBadge tone={item.tone}>{prettyStatus(event.status)}</StatusBadge>} />
        <Detail label="Timestamp" value={formatDateTime(event.timestamp)} />
        <Detail label="Tool" value={formatToolName(event)} />
        <Detail label="Input" value={summarizeInput(event)} />
        <Detail label="Latency" value={formatLatency(event.latency_ms)} />
        {event.reason ? <Detail label="Reason" value={event.reason} /> : null}
        {event.error ? <Detail label="Error" value={formatError(event.error)} /> : null}
      </dl>
      {event.input ? <Preview title="Input payload" value={event.input} /> : null}
      {event.output_summary ? <Preview title="Output summary" value={event.output_summary} /> : null}
      <details className="rawDetails">
        <summary>
          <FileJson size={15} />
          Raw event JSON
        </summary>
        <pre>{formatJson(event)}</pre>
      </details>
    </section>
  );
}

function BlockTitle({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div className="blockTitle">
      {icon}
      <h3>{title}</h3>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function Preview({ title, value }: { title: string; value: unknown }) {
  return (
    <div className="previewBlock">
      <strong>{title}</strong>
      <pre>{formatJson(value)}</pre>
    </div>
  );
}

function modeTone(mode: RunMode) {
  if (mode === "completed") return "success";
  if (mode === "waiting_for_approval") return "warning";
  if (mode === "failed" || mode === "rejected" || mode === "blocked") return "danger";
  if (mode === "running") return "active";
  return "neutral";
}
