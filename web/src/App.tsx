import { useEffect, useMemo, useRef, useState } from "react";
import { AgentRouteMap } from "./components/AgentRouteMap";
import { EmptyState } from "./components/EmptyState";
import { EventTimeline } from "./components/EventTimeline";
import { Header } from "./components/Header";
import { HealthPanel } from "./components/HealthPanel";
import { InspectorPanel } from "./components/InspectorPanel";
import { RunHero } from "./components/RunHero";
import {
  decideApproval as decideApprovalRequest,
  getRunEvents,
  listHealth,
  listRuns,
  startJourneyDemo,
  startSafetyDemo
} from "./lib/api";
import {
  eventTypes,
  getPendingApproval,
  getPrimaryToolCall,
  getRouteNodes,
  getRunMode,
  isHealthEvent,
  upsertRun
} from "./lib/eventUtils";
import type { Health, Run, WatchtowerEvent } from "./types";

export function App() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [activeRun, setActiveRun] = useState<Run | null>(null);
  const [events, setEvents] = useState<WatchtowerEvent[]>([]);
  const [health, setHealth] = useState<Health[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [approvalBusy, setApprovalBusy] = useState<string | null>(null);
  const [healthRefreshing, setHealthRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<EventSource | null>(null);

  useEffect(() => {
    let mounted = true;

    async function boot() {
      try {
        const [nextRuns, nextHealth] = await Promise.all([listRuns(), listHealth()]);
        if (!mounted) return;
        setRuns(nextRuns);
        setHealth(nextHealth);
        if (nextRuns[0]) {
          await openRun(nextRuns[0]);
        }
      } catch (err) {
        if (mounted) setError(errorMessage(err));
      }
    }

    void boot();
    return () => {
      mounted = false;
      streamRef.current?.close();
    };
  }, []);

  async function refreshRuns() {
    const nextRuns = await listRuns();
    setRuns(nextRuns);
    return nextRuns;
  }

  async function refreshHealth() {
    setHealthRefreshing(true);
    try {
      setHealth(await listHealth());
    } catch (err) {
      setError(errorMessage(err));
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
      setRuns((current) => upsertRun(current, existing.run));
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
        setEvents((current) => {
          if (current.some((item) => item.event_id === payload.event_id)) return current;
          return [...current, payload];
        });

        if (isHealthEvent(payload)) void refreshHealth();

        if (payload.type === "run_completed" || payload.type === "run_failed") {
          const status = payload.type === "run_completed" ? "completed" : "failed";
          const completedAt = payload.timestamp;
          setActiveRun((current) =>
            current && current.run_id === payload.run_id
              ? { ...current, status, completed_at: completedAt }
              : current
          );
          setRuns((current) =>
            current.map((run) =>
              run.run_id === payload.run_id ? { ...run, status, completed_at: completedAt } : run
            )
          );
          void refreshRuns();
        }
      });
    });

    streamRef.current = source;
  }

  async function handleStartDemo() {
    try {
      setError(null);
      const run = await startJourneyDemo();
      setRuns((current) => upsertRun(current, run));
      await openRun(run);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function handleStartSafetyDemo() {
    try {
      setError(null);
      const run = await startSafetyDemo();
      setRuns((current) => upsertRun(current, run));
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
    () => events.find((event) => event.event_id === selectedEventId) ?? null,
    [events, selectedEventId]
  );

  return (
    <main className="appShell">
      <Header
        runs={runs}
        activeRunId={activeRun?.run_id}
        onOpenRun={(run) => void openRun(run)}
        onStartDemo={() => void handleStartDemo()}
        onStartSafetyDemo={() => void handleStartSafetyDemo()}
      />

      {error ? <div className="errorBanner">{error}</div> : null}

      {!activeRun ? (
        <>
          <EmptyState onStartDemo={() => void handleStartDemo()} onStartSafetyDemo={() => void handleStartSafetyDemo()} />
          <HealthPanel health={health} refreshing={healthRefreshing} onRefresh={() => void refreshHealth()} />
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
          <HealthPanel health={health} refreshing={healthRefreshing} onRefresh={() => void refreshHealth()} />
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
        </>
      )}
    </main>
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unexpected frontend error";
}
