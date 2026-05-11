import { Activity, RefreshCw, Server } from "lucide-react";
import type { Health } from "../types";
import { formatDateTime, formatLatency, getHealthTone, prettyStatus } from "../lib/eventUtils";
import { StatusBadge } from "./StatusBadge";

type HealthPanelProps = {
  health: Health[];
  refreshing?: boolean;
  onRefresh: () => void;
};

export function HealthPanel({ health, refreshing, onRefresh }: HealthPanelProps) {
  return (
    <section className="healthPanel">
      <div className="healthHeader">
        <div>
          <p className="eyebrow">MCP service health</p>
          <h2>Servers</h2>
        </div>
        <button className="iconButton" type="button" onClick={onRefresh} aria-label="Refresh server health">
          <RefreshCw size={15} className={refreshing ? "spin" : undefined} />
        </button>
      </div>
      <div className="healthChips">
        {health.length === 0 ? (
          <div className="healthChip neutral">
            <Server size={16} />
            <strong>No health checks yet</strong>
            <span>Start a run</span>
          </div>
        ) : (
          health.map((item) => (
            <div className={`healthChip ${getHealthTone(item)}`} key={item.server}>
              <Activity size={16} />
              <strong>{item.server}</strong>
              <StatusBadge tone={getHealthTone(item)}>{prettyStatus(item.status)}</StatusBadge>
              <span>{item.tools_count} tools</span>
              <span>{formatLatency(item.latency_ms)}</span>
              <small>{formatDateTime(item.last_checked_at)}</small>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
