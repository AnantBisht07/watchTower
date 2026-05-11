import { Play, RadioTower, ShieldCheck } from "lucide-react";
import type { Run } from "../types";
import { runScenario } from "../lib/eventUtils";
import { StatusBadge } from "./StatusBadge";

type HeaderProps = {
  runs: Run[];
  activeRunId?: string;
  onOpenRun: (run: Run) => void;
  onStartDemo: () => void;
  onStartSafetyDemo: () => void;
};

export function Header({ runs, activeRunId, onOpenRun, onStartDemo, onStartSafetyDemo }: HeaderProps) {
  return (
    <header className="topHeader">
      <div className="brandBlock">
        <div className="brandMark" aria-hidden="true">
          <RadioTower size={22} />
        </div>
        <div>
          <h1>MCP Watchtower</h1>
          <p>Live execution cockpit for MCP agents</p>
        </div>
      </div>

      <div className="headerControls">
        <button className="secondaryButton" type="button" onClick={onStartDemo}>
          <Play size={16} />
          Journey Demo
        </button>
        <button className="primaryButton" type="button" onClick={onStartSafetyDemo}>
          <ShieldCheck size={16} />
          Safety Demo
        </button>
        <label className="runSelect">
          <span>Run</span>
          <select
            value={activeRunId ?? ""}
            onChange={(event) => {
              const nextRun = runs.find((run) => run.run_id === event.target.value);
              if (nextRun) onOpenRun(nextRun);
            }}
          >
            <option value="" disabled>
              Select run
            </option>
            {runs.map((run) => (
              <option key={run.run_id} value={run.run_id}>
                {runScenario(run)} - {run.status}
              </option>
            ))}
          </select>
        </label>
        {runs.length ? <StatusBadge tone="neutral">{runs.length} runs</StatusBadge> : null}
      </div>
    </header>
  );
}
