import { useEffect, useMemo, useRef, useState } from "react";
import { AgentRouteMap } from "../components/AgentRouteMap";
import { EmptyState } from "../components/EmptyState";
import { EventTimeline } from "../components/EventTimeline";
import { HealthPanel } from "../components/HealthPanel";
import { InspectorPanel } from "../components/InspectorPanel";
import { ReliabilityPanel } from "../components/ReliabilityPanel";
import { RunHero } from "../components/RunHero";
import { getRunEvents, listHealth, listRuns, listToolReliability, startJourneyDemo, startSafetyDemo } from "../lib/api";
import {
  decideApproval as decideApprovalRequest,
} from "../lib/api";
import {
  eventTypes,
  getPendingApproval,
  getPrimaryToolCall,
  getRouteNodes,
  getRunMode,
  isHealthEvent,
  upsertRun,
} from "../lib/eventUtils";
import type { Health, Run, ToolReliability, WatchtowerEvent } from "../types";

type RunsPageProps = {
  /** Runs list pre-fetched by App; kept in sync here too */
  initialRuns: Run[];
  initialHealth: Health[];
  initialReliability: ToolReliability[];
  /** When App already has an active run to open (e.g. navigated from Mission Control) */
  requestedRun?: Run | null;
  onRunsChange: (runs: Run[]) => void;
};

export function RunsPage({
  initialRuns,
  initialHealth,
  initialReliability,
  requestedRun,
  onRunsChange,
}: RunsPageProps) {
  const [runs, setRuns] = useState<Run[]>(initialRuns);
  const [activeRun, setActiveRun] = useState<Run | null>(null);
  const [events, setEvents] = useState<WatchtowerEvent[]>([]);
  const [health, setHealth] = useState<Health[]>(initialHealth);
  const [reliability, setReliability] = useState<ToolReliability[]>(initialReliability);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [approvalBusy, setApprovalBusy] = useState<string | null>(null);
  const [healthRefreshing, setHealthRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<EventSource | null>(null);
  const openedRunRef = useRef<string | null>(null);

  // Sync parent-level runs into local state when they change
  useEffect(() => {
    setRuns(initialRuns);
  }, [initialRuns]);

  useEffect(() => {
    setHealth(initialHealth);
  }, [initialHealth]);

  useEffect(() => {
    setReliability(initialReliability);
  }, [initialReliability]);

  // Auto-open a run requested from outside (e.g. Mission Control click)
  useEffect(() => {
    if (requestedRun && requestedRun.run_id !== openedRunRef.current) {
      openedRunRef.current = requestedRun.run_id;
      void openRun(requestedRun);
    }
  }, [requestedRun]);

  async function refreshRuns() {
    const next = await listRuns();
    setRuns(next);
    onRunsChange(next);
    return next;
  }

  async function refreshHealth() {
    setHealthRefreshing(true);
    try {
      setHealth(await listHealth());
    } finally {
      setHealthRefreshing(false);
    }
  }

  async function openRun(run: Run) {
    streamRef.current?.close();
    setError(null);
    setActiveRun(run);
    setEvents([]);
    setSelectedEventId(null);

    try {
      const existing = await getRunEvents(run.run_id);
      setActiveRun(existing.run);
      setRuns((cur) => upsertRun(cur, existing.run));
      setEvents(existing.events);
      openEventStream(existing.run.run_id);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  function openEventStream(runId: string) {
    const source = new EventSource(`/api/runs/${runId}/events/stream`);

    eventTypes.forEach((type) => {
      source.addEventListener(type, (event) => {
        const payload = JSON.parse((event as MessageEvent).data) as WatchtowerEvent;
        setEvents((cur) => {
          if (cur.some((e) => e.event_id === payload.event_id)) return cur;
          return [...cur, payload];
        });

        if (isHealthEvent(payload)) void refreshHealth();

        if (
          payload.type === "tool_call_completed" ||
          payload.type === "tool_call_failed" ||
          payload.type === "tool_call_timeout"
        ) {
          void listToolReliability().then(setReliability).catch(() => undefined);
        }

        if (payload.type === "run_completed" || payload.type === "run_failed") {
          const status = payload.type === "run_completed" ? "completed" : "failed";
          const completedAt = payload.timestamp;
          setActiveRun((cur) =>
            cur && cur.run_id === payload.run_id
              ? { ...cur, status, completed_at: completedAt }
              : cur,
          );
          setRuns((cur) =>
            cur.map((r) =>
              r.run_id === payload.run_id ? { ...r, status, completed_at: completedAt } : r,
            ),
          );
          void refreshRuns();
        }
      });
    });

    streamRef.current = source;

    return () => source.close();
  }

  async function handleStartDemo() {
    try {
      setError(null);
      const run = await startJourneyDemo();
      setRuns((cur) => upsertRun(cur, run));
      await openRun(run);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function handleStartSafetyDemo() {
    try {
      setError(null);
      const run = await startSafetyDemo();
      setRuns((cur) => upsertRun(cur, run));
      await openRun(run);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function handleDecision(approvalId: string, decision: "approve" | "reject") {
    setApprovalBusy(approvalId);
    setError(null);
    try {
      await decideApprovalRequest(approvalId, decision);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setApprovalBusy(null);
    }
  }

  const mode = useMemo(() => getRunMode(activeRun, events), [activeRun, events]);
  const pendingApproval = useMemo(() => getPendingApproval(events, activeRun), [events, activeRun]);
  const primaryToolCall = useMemo(() => getPrimaryToolCall(activeRun, events), [activeRun, events]);
  const routeNodes = useMemo(() => getRouteNodes(activeRun, events), [activeRun, events]);
  const selectedEvent = useMemo(
    () => events.find((e) => e.event_id === selectedEventId) ?? null,
    [events, selectedEventId],
  );

  return (
    <div className="pageContent">
      {error ? <div className="errorBanner">{error}</div> : null}

      {/* Run selector strip */}
      {runs.length > 0 && (
        <div className="runStrip">
          {runs.slice(0, 8).map((run) => (
            <button
              key={run.run_id}
              className={`runStripItem ${activeRun?.run_id === run.run_id ? "active" : ""} ${run.status}`}
              type="button"
              onClick={() => void openRun(run)}
              title={run.task ?? run.app_name}
            >
              <span className="runStripName">{run.app_name}</span>
              <span className="runStripStatus">{run.status}</span>
            </button>
          ))}
          <button
            className="secondaryButton"
            type="button"
            style={{ height: 34, fontSize: 12, marginLeft: "auto" }}
            onClick={() => void handleStartDemo()}
          >
            + New demo
          </button>
        </div>
      )}

      {!activeRun ? (
        <>
          <EmptyState
            onStartDemo={() => void handleStartDemo()}
            onStartSafetyDemo={() => void handleStartSafetyDemo()}
          />
          <HealthPanel health={health} refreshing={healthRefreshing} onRefresh={() => void refreshHealth()} />
          <ReliabilityPanel reliability={reliability} />
        </>
      ) : (
        <>
          <RunHero
            run={activeRun}
            events={events}
            health={health}
            mode={mode}
            pendingApproval={pendingApproval}
            primaryToolCall={primaryToolCall}
            approvalBusy={approvalBusy}
            onDecision={handleDecision}
          />
          <div className="controlGrid">
            <div className="primaryStack">
              <AgentRouteMap nodes={routeNodes} />
              <EventTimeline
                events={events}
                selectedEventId={selectedEventId ?? undefined}
                onSelectEvent={(event) => setSelectedEventId(event.event_id)}
              />
            </div>
            <InspectorPanel
              run={activeRun}
              events={events}
              health={health}
              mode={mode}
              selectedEvent={selectedEvent}
              pendingApproval={pendingApproval}
              primaryToolCall={primaryToolCall}
              approvalBusy={approvalBusy}
              onDecision={handleDecision}
            />
          </div>
          <ReliabilityPanel reliability={reliability} />
        </>
      )}
    </div>
  );
}

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : "Unexpected error";
}
