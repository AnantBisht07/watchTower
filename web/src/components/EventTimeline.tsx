import {
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  Clock3,
  FileWarning,
  RadioTower,
  Server,
  ShieldAlert,
  Wrench,
  XCircle
} from "lucide-react";
import type { WatchtowerEvent } from "../types";
import { formatTime, formatToolName, getStatusTone, getTimelineItem, prettyStatus } from "../lib/eventUtils";
import { StatusBadge } from "./StatusBadge";

type EventTimelineProps = {
  events: WatchtowerEvent[];
  selectedEventId?: string;
  onSelectEvent: (event: WatchtowerEvent) => void;
};

export function EventTimeline({ events, selectedEventId, onSelectEvent }: EventTimelineProps) {
  return (
    <section className="timelineCard">
      <div className="sectionHeader">
        <div>
          <p className="eyebrow">Flight recorder</p>
          <h2>Audit Trail</h2>
        </div>
        <StatusBadge tone="neutral">{events.length} events</StatusBadge>
      </div>

      <div className="timelineList">
        {events.length === 0 ? (
          <div className="timelineEmpty">No events recorded yet.</div>
        ) : (
          events.map((event) => {
            const item = getTimelineItem(event, events);
            const selected = event.event_id === selectedEventId;
            return (
              <button
                className={`timelineRow ${item.tone} ${item.important ? "important" : ""} ${selected ? "selected" : ""}`}
                key={event.event_id}
                type="button"
                onClick={() => onSelectEvent(event)}
              >
                <time>{formatTime(event.timestamp)}</time>
                <span className="timelineIcon">{iconForEvent(event)}</span>
                <span className="timelineBody">
                  <span className="timelineTitle">
                    <strong>{item.title}</strong>
                    <StatusBadge tone={item.tone}>{item.badge ?? prettyStatus(event.status)}</StatusBadge>
                  </span>
                  <span>{item.message}</span>
                  <small>
                    {formatToolName(event)}
                    {event.latency_ms !== undefined ? ` / ${event.latency_ms}ms` : ""}
                  </small>
                </span>
              </button>
            );
          })
        )}
      </div>
    </section>
  );
}

function iconForEvent(event: WatchtowerEvent) {
  if (event.type === "approval_required" || event.type === "tool_call_approval_required") return <ShieldAlert size={16} />;
  if (event.type === "tool_call_rejected") return <XCircle size={16} />;
  if (event.type.includes("failed") || event.type.includes("timeout")) return <AlertTriangle size={16} />;
  if (event.type === "tool_call_completed" || event.type === "run_completed") return <CheckCircle2 size={16} />;
  if (event.type.startsWith("health") || event.type.startsWith("mcp_server")) return <Server size={16} />;
  if (event.type.startsWith("tool_call")) return <Wrench size={16} />;
  if (event.type.startsWith("agent")) return <CircleDot size={16} />;
  if (event.type === "run_failed") return <FileWarning size={16} />;
  if (getStatusTone(event.status) === "active") return <RadioTower size={16} />;
  return <Clock3 size={16} />;
}
