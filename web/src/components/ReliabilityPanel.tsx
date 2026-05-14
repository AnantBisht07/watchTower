import { BarChart2, CheckCircle, Clock, XCircle } from "lucide-react";
import type { ToolReliability } from "../types";
import { formatLatency } from "../lib/eventUtils";

type ReliabilityPanelProps = {
  reliability: ToolReliability[];
};

function successRate(row: ToolReliability): number {
  const total = row.success_count + row.failure_count + row.timeout_count;
  return total === 0 ? 100 : Math.round((row.success_count / total) * 100);
}

function rateTone(rate: number): string {
  if (rate >= 95) return "success";
  if (rate >= 80) return "warning";
  return "danger";
}

export function ReliabilityPanel({ reliability }: ReliabilityPanelProps) {
  return (
    <section className="reliabilityPanel">
      <div className="reliabilityHeader">
        <p className="eyebrow">Tool performance</p>
        <h2>Reliability</h2>
      </div>

      {reliability.length === 0 ? (
        <div className="reliabilityEmpty">
          <BarChart2 size={20} />
          <span>No tool calls yet — start a run to see stats.</span>
        </div>
      ) : (
        <div className="reliabilityTable">
          <div className="reliabilityRow reliabilityHeading">
            <span>Tool</span>
            <span>Success rate</span>
            <span>Calls</span>
            <span>Avg latency</span>
          </div>
          {reliability.map((row) => {
            const rate = successRate(row);
            const tone = rateTone(rate);
            const total = row.success_count + row.failure_count + row.timeout_count;
            return (
              <div className="reliabilityRow" key={`${row.server}.${row.tool}`}>
                <span className="reliabilityTool">
                  <strong>{row.server}</strong>
                  <span className="reliabilityDot">·</span>
                  {row.tool}
                </span>
                <span className={`reliabilityRate ${tone}`}>
                  {tone === "success" ? (
                    <CheckCircle size={13} />
                  ) : tone === "warning" ? (
                    <Clock size={13} />
                  ) : (
                    <XCircle size={13} />
                  )}
                  {rate}%
                </span>
                <span className="reliabilityCalls">
                  <span className="success">{row.success_count}✓</span>
                  {row.failure_count > 0 && <span className="danger">{row.failure_count}✗</span>}
                  {row.timeout_count > 0 && <span className="warning">{row.timeout_count}⏱</span>}
                  <span className="neutral">/{total}</span>
                </span>
                <span className="reliabilityLatency">{formatLatency(row.avg_latency_ms)}</span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
