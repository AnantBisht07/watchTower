import { useCallback, useEffect, useRef, useState } from "react";
import { PendingBanner } from "./components/PendingBanner";
import { SideNav, type NavView } from "./components/SideNav";
import { listApprovals, listHealth, listRecentEvents, listRuns, listToolReliability, decideApproval } from "./lib/api";
import { ApprovalsPage } from "./pages/ApprovalsPage";
import { MissionControlPage } from "./pages/MissionControlPage";
import { PoliciesPage } from "./pages/PoliciesPage";
import { RunsPage } from "./pages/RunsPage";
import { ServersPage } from "./pages/ServersPage";
import { SettingsPage } from "./pages/SettingsPage";
import type { Approval, Health, Run, ToolReliability, WatchtowerEvent } from "./types";

const POLL_MS = 8_000;

export function App() {
  const [view, setView] = useState<NavView>("mission");

  // ── Global shared state ──────────────────────────────────────────────
  const [runs, setRuns] = useState<Run[]>([]);
  const [health, setHealth] = useState<Health[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [reliability, setReliability] = useState<ToolReliability[]>([]);
  const [recentEvents, setRecentEvents] = useState<WatchtowerEvent[]>([]);
  const [healthRefreshing, setHealthRefreshing] = useState(false);
  const [approvalBusy, setApprovalBusy] = useState<string | null>(null);

  // Run to auto-open in RunsPage when clicking from Mission Control
  const [requestedRun, setRequestedRun] = useState<Run | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const pendingCount = approvals.filter((a) => a.status === "waiting").length;

  // ── Boot + polling ───────────────────────────────────────────────────
  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const [nextRuns, nextHealth, nextApprovals, nextReliability, nextEvents] = await Promise.all([
        listRuns(),
        listHealth(),
        listApprovals(),
        listToolReliability(),
        listRecentEvents(30),
      ]);
      if (signal?.aborted) return;
      setRuns(nextRuns);
      setHealth(nextHealth);
      setApprovals(nextApprovals);
      setReliability(nextReliability);
      setRecentEvents(nextEvents);
    } catch {
      // best-effort polling — ignore transient errors
    }
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    void refresh(ctrl.signal);
    pollRef.current = setInterval(() => void refresh(ctrl.signal), POLL_MS);
    return () => {
      ctrl.abort();
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [refresh]);

  // ── Shared actions ───────────────────────────────────────────────────
  async function handleDecision(approvalId: string, decision: "approve" | "reject") {
    setApprovalBusy(approvalId);
    try {
      await decideApproval(approvalId, decision);
      // Immediately refresh approvals so UI reflects the decision
      const next = await listApprovals();
      setApprovals(next);
    } finally {
      setApprovalBusy(null);
    }
  }

  async function handleRefreshHealth() {
    setHealthRefreshing(true);
    try {
      setHealth(await listHealth());
    } finally {
      setHealthRefreshing(false);
    }
  }

  function handleOpenRunFromMission(run: Run) {
    setRequestedRun(run);
    setView("runs");
  }

  function handleNavigate(nextView: NavView) {
    setView(nextView);
    // Kick a refresh when the user switches tabs so data is fresh
    void refresh();
  }

  // ── Render ───────────────────────────────────────────────────────────
  return (
    <div className="appShell">
      <SideNav
        active={view}
        pendingCount={pendingCount}
        onNavigate={handleNavigate}
      />

      <div className="pageArea">
        <PendingBanner
          count={pendingCount}
          onViewApprovals={() => handleNavigate("approvals")}
        />

        {view === "mission" && (
          <MissionControlPage
            runs={runs}
            health={health}
            approvals={approvals}
            reliability={reliability}
            recentEvents={recentEvents}
            approvalBusy={approvalBusy}
            onDecision={handleDecision}
            onViewApprovals={() => handleNavigate("approvals")}
            onOpenRun={handleOpenRunFromMission}
          />
        )}

        {view === "runs" && (
          <RunsPage
            initialRuns={runs}
            initialHealth={health}
            initialReliability={reliability}
            requestedRun={requestedRun}
            onRunsChange={setRuns}
          />
        )}

        {view === "servers" && (
          <ServersPage
            health={health}
            reliability={reliability}
            refreshing={healthRefreshing}
            onRefresh={() => void handleRefreshHealth()}
          />
        )}

        {view === "approvals" && (
          <ApprovalsPage
            approvals={approvals}
            approvalBusy={approvalBusy}
            onDecision={handleDecision}
            onRefresh={() => void refresh()}
          />
        )}

        {view === "policies" && <PoliciesPage />}
        {view === "settings" && <SettingsPage />}
      </div>
    </div>
  );
}
