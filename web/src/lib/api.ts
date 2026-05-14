import type { Health, Run, RunEventsResponse, ToolReliability } from "../types";

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`${init?.method ?? "GET"} ${url} failed with ${response.status}`);
  }
  return (await response.json()) as T;
}

export function listRuns() {
  return requestJson<Run[]>("/api/runs");
}

export function getRunEvents(runId: string) {
  return requestJson<RunEventsResponse>(`/api/runs/${runId}/events`);
}

export function listHealth() {
  return requestJson<Health[]>("/api/servers/health");
}

export function startJourneyDemo() {
  return requestJson<Run>("/api/runs/demo", { method: "POST" });
}

export function startSafetyDemo() {
  return requestJson<Run>("/api/runs/safety-demo", { method: "POST" });
}

export function decideApproval(approvalId: string, decision: "approve" | "reject") {
  return requestJson<unknown>(`/api/approvals/${approvalId}/${decision}`, { method: "POST" });
}

export function listToolReliability() {
  return requestJson<ToolReliability[]>("/api/tools/reliability");
}
