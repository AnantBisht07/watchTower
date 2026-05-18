import { RefreshCw } from "lucide-react";
import { StatusBadge } from "../components/StatusBadge";
import { formatLatency, getHealthTone, prettyStatus } from "../lib/eventUtils";
import type { Health, ToolReliability } from "../types";

type ServersPageProps = {
  health: Health[];
  reliability: ToolReliability[];
  refreshing: boolean;
  onRefresh: () => void;
};

export function ServersPage({ health, reliability, refreshing, onRefresh }: ServersPageProps) {
  return (
    <div className="pageContent">
      <div className="pageHeader">
        <div>
          <h2>Servers</h2>
          <p>MCP server fleet — health and tool reliability</p>
        </div>
        <button className="secondaryButton" type="button" onClick={onRefresh}>
          <RefreshCw size={14} className={refreshing ? "spin" : undefined} />
          Refresh
        </button>
      </div>

      {/* Server health fleet table */}
      <div className="mcSection">
        <div className="mcSectionHeader">
          <div className="mcSectionTitle">
            <h3>Server health</h3>
          </div>
          <span style={{ color: "var(--text-faint)", fontSize: 11 }}>{health.length} servers</span>
        </div>

        <div className="serversTable">
          <div className="serversRow heading">
            <span>Server</span>
            <span>Status</span>
            <span>Tools</span>
            <span>Latency</span>
            <span>Last checked</span>
            <span>Error</span>
          </div>
          {health.length === 0 ? (
            <div className="approvalQueueEmpty" style={{ gridColumn: "1 / -1", padding: "24px 16px" }}>
              No servers checked yet — start a run to discover servers.
            </div>
          ) : (
            health.map((item) => (
              <div className="serversRow" key={item.server}>
                <span className="serverName">
                  <span className={`healthDot ${getHealthTone(item)}`} />
                  <strong>{item.server}</strong>
                </span>
                <span>
                  <StatusBadge tone={getHealthTone(item)}>{prettyStatus(item.status)}</StatusBadge>
                </span>
                <span style={{ color: "var(--text-muted)" }}>{item.tools_count}</span>
                <span style={{ color: "var(--text-muted)" }}>{formatLatency(item.latency_ms)}</span>
                <span style={{ color: "var(--text-faint)", fontSize: 11 }}>
                  {item.last_checked_at ? shortDate(item.last_checked_at) : "—"}
                </span>
                <span style={{ color: "var(--rose)", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {item.last_error ?? "—"}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Tool reliability per server */}
      <div className="mcSection">
        <div className="mcSectionHeader">
          <div className="mcSectionTitle">
            <h3>Tool reliability</h3>
          </div>
          <span style={{ color: "var(--text-faint)", fontSize: 11 }}>{reliability.length} tools tracked</span>
        </div>

        <div className="serversTable">
          <div className="serversRow heading" style={{ gridTemplateColumns: "minmax(0,1fr) 70px 60px 100px 90px 80px" }}>
            <span>Tool</span>
            <span>Rate</span>
            <span>Calls</span>
            <span>Avg latency</span>
            <span>Last call</span>
            <span>Last status</span>
          </div>
          {reliability.length === 0 ? (
            <div className="approvalQueueEmpty" style={{ gridColumn: "1 / -1", padding: "24px 16px" }}>
              No tool calls recorded yet.
            </div>
          ) : (
            reliability.map((row) => {
              const total = row.success_count + row.failure_count + row.timeout_count;
              const rate = total === 0 ? 100 : Math.round((row.success_count / total) * 100);
              const tone = rate >= 95 ? "success" : rate >= 80 ? "warning" : "danger";
              return (
                <div
                  className="serversRow"
                  key={`${row.server}.${row.tool}`}
                  style={{ gridTemplateColumns: "minmax(0,1fr) 70px 60px 100px 90px 80px" }}
                >
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
                    <span style={{ color: "var(--text-muted)" }}>{row.server}.</span>
                    {row.tool}
                  </span>
                  <span>
                    <StatusBadge tone={tone}>{rate}%</StatusBadge>
                  </span>
                  <span style={{ color: "var(--text-faint)" }}>{total}</span>
                  <span style={{ color: "var(--text-muted)" }}>{formatLatency(row.avg_latency_ms)}</span>
                  <span style={{ color: "var(--text-faint)", fontSize: 11 }}>
                    {row.last_called_at ? shortDate(row.last_called_at) : "—"}
                  </span>
                  <span>
                    {row.last_status ? (
                      <StatusBadge tone={row.last_status === "completed" ? "success" : "danger"}>
                        {row.last_status}
                      </StatusBadge>
                    ) : (
                      <span style={{ color: "var(--text-faint)" }}>—</span>
                    )}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  const secs = Math.floor((Date.now() - d.getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
