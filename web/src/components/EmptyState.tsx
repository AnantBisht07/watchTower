import { Play, Radar, Route, ShieldCheck } from "lucide-react";

type EmptyStateProps = {
  onStartDemo: () => void;
  onStartSafetyDemo: () => void;
};

export function EmptyState({ onStartDemo, onStartSafetyDemo }: EmptyStateProps) {
  return (
    <section className="emptyCockpit">
      <div className="emptyIcon" aria-hidden="true">
        <Radar size={34} />
      </div>
      <div className="emptyCopy">
        <p className="eyebrow">Control tower idle</p>
        <h2>Start a run to watch MCP execution</h2>
        <p>
          Watchtower will show the agent route, policy checks, approval gates, MCP tool calls, and audit trail.
        </p>
      </div>
      <div className="emptyActions">
        <button className="primaryButton" type="button" onClick={onStartDemo}>
          <Play size={17} />
          Start Journey Demo
        </button>
        <button className="secondaryButton" type="button" onClick={onStartSafetyDemo}>
          <ShieldCheck size={17} />
          Start Safety Demo
        </button>
      </div>
      <div className="emptyRoute" aria-hidden="true">
        {["User Task", "Agent", "Watchtower", "Policy", "MCP"].map((label, index) => (
          <div className="emptyRouteNode" key={label}>
            <span>{index === 2 ? <Route size={15} /> : index + 1}</span>
            <strong>{label}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}
