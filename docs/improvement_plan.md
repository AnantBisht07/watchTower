# MCP Watchtower — Improvement Plan

This document turns the findings in [`docs/analysis.md`](analysis.md) into a concrete, phased roadmap, and adds the ecosystem, community, and tooling work the analysis did not cover.

The goal is to take MCP Watchtower from a **6 / 10 alpha prototype** to a **9 / 10 open source tool that developers actually adopt**.

---

## Vision & Success Criteria

**Vision:** A local-first control plane for MCP-powered agents that makes tool calls visible, controllable, and reliable — without forcing teams to adopt a cloud observability backend.

**A successful v1.0 ships when:**

1. A developer can run `pip install mcp-watchtower`, wrap a real `mcp.ClientSession`, and see live events in the browser within five minutes.
2. The approval gate works in a separate process from the agent (cross-process live streaming).
3. The default install is safe on a shared dev machine (API token auth, redaction).
4. There is at least one published real-world integration guide (Claude Desktop, Cline, or Cursor).
5. CI runs tests + lint + type checks on every PR.
6. The README has a 30-second demo GIF that explains the product without reading.

---

## Phase 0 — Foundation Hygiene (Week 1)

Small, fast wins that unblock everything else.

### 0.1 — CI/CD pipeline
- **What:** Add `.github/workflows/ci.yml` running on push and PR.
- **Steps:**
  - Python: `pip install -e ".[dev,server]"` → `pytest` → `ruff check .`
  - Frontend: `npm ci` → `npm run build` → `npx playwright test`
  - Matrix: Python 3.11 + 3.12 on Ubuntu + macOS + Windows.
- **Acceptance:** Every PR shows green/red status checks. README gets a CI badge.
- **Effort:** 0.5 day.

### 0.2 — Type checking
- **What:** Add `mypy` (or `pyright`) with strict mode on `mcp_watchtower/`.
- **Steps:** Add `mypy.ini` with `strict = True`; fix any new violations; run in CI.
- **Acceptance:** `mypy mcp_watchtower/` passes in CI.
- **Effort:** 0.5 day.

### 0.3 — Linting enforcement
- **What:** Ruff is configured in `pyproject.toml` but not enforced.
- **Steps:** Add `ruff check .` and `ruff format --check .` to CI.
- **Acceptance:** Lint failures block merges.
- **Effort:** 2 hours.

### 0.4 — Community files
- **What:** Add the standard open source files.
- **Files to create:**
  - `CONTRIBUTING.md` — dev setup, branch/PR conventions, commit style
  - `CODE_OF_CONDUCT.md` — Contributor Covenant 2.1
  - `SECURITY.md` — how to report vulnerabilities, supported versions
  - `.github/ISSUE_TEMPLATE/bug_report.yml`
  - `.github/ISSUE_TEMPLATE/feature_request.yml`
  - `.github/PULL_REQUEST_TEMPLATE.md`
- **Acceptance:** GitHub shows the "community standards" checklist as 100%.
- **Effort:** 1 day.

### 0.5 — Cross-platform README
- **What:** Show macOS/Linux commands first, then PowerShell.
- **Steps:** Already partially done. Verify the demo command works end-to-end on a Mac and a clean Ubuntu container.
- **Acceptance:** A new contributor on macOS can run the demo in under five minutes.
- **Effort:** 2 hours.

---

## Phase 1 — Real MCP Integration (Weeks 2–3)

Without this, the project is just a fake-event toy. This is the single highest-leverage piece of work.

### 1.1 — Official MCP SDK adapter
- **What:** Ship a working adapter for the `mcp` Python package's `ClientSession`.
- **Files:**
  - `mcp_watchtower/adapters/__init__.py`
  - `mcp_watchtower/adapters/mcp_sdk.py` — `wrap_mcp_session(session, server_name, ...)` returns a `WatchtowerMCPClient`
- **Steps:**
  1. Add `mcp` to `[project.optional-dependencies].mcp`.
  2. Map `ClientSession.call_tool(name, arguments)` → `WatchtowerMCPClient.call_tool`.
  3. Map `ClientSession.list_tools()` → `HealthChecker._list_tools`.
  4. Handle `mcp.types.CallToolResult` (it has `content`, `isError`) in `summarize_output`.
- **Acceptance:** A test using `mcp.ClientSession` (stdio transport, real subprocess) runs end-to-end and produces a full event lifecycle.
- **Effort:** 3 days.

### 1.2 — Reference example: Claude Desktop config
- **What:** A working example that wraps a real public MCP server (`@modelcontextprotocol/server-filesystem` via npx).
- **File:** `examples/mcp_sdk_filesystem/main.py`
- **Acceptance:** `python examples/mcp_sdk_filesystem/main.py` lists tools, calls `read_file`, and the run appears in the UI.
- **Effort:** 1 day.

### 1.3 — Reference example: GitHub MCP server
- **File:** `examples/mcp_sdk_github/main.py` (uses `@modelcontextprotocol/server-github`).
- **Acceptance:** Demonstrates the approval gate stopping a `create_issue` call.
- **Effort:** 1 day.

---

## Phase 2 — Fix the Broken APIs (Week 4)

The misleading and inefficient parts called out in the analysis.

### 2.1 — Async approval signaling
- **What:** Replace polling with `asyncio.Event` keyed by `approval_id`.
- **Files to change:**
  - `bus.py`: add `signal_approval(approval_id, status)` and `wait_for_approval(approval_id, timeout)`.
  - `emitter.py`: after persisting `tool_call_approved`/`tool_call_rejected`, call `bus.signal_approval`.
  - `mcp_wrapper.py`: replace polling loop with `await self._emitter.bus.wait_for_approval(...)`.
- **Acceptance:** SQLite read count during a 60-second pending approval drops from ~240 to 1. `test_wrapper_waits_for_approval_before_state_changing_tool` still passes.
- **Effort:** 2 days.

### 2.2 — Implement `Watchtower(ui=True)`
- **What:** When `ui=True`, start `uvicorn` in a background thread and print the URL.
- **Files:** `watchtower.py`, `server.py`.
- **Steps:**
  1. Use `threading.Thread(target=uvicorn.run, ...)` with `daemon=True`.
  2. Pick a free port if 8123 is busy.
  3. Print `Watchtower UI: http://127.0.0.1:8123/runs/{run_id}` on construction.
- **Acceptance:** `Watchtower(app_name="x", ui=True)` prints a URL and opening it shows the live run.
- **Effort:** 1.5 days.

### 2.3 — Fix Journey Demo's hanging approval
- **What:** `fake_runner.run_fake_journey` emits `approval_required` then immediately `run_completed`, leaving an approval orphaned.
- **Fix:** Either auto-resolve the approval after a delay (clean demo) or emit `run_failed` if no decision arrives.
- **Acceptance:** After the Journey Demo, the approvals list is empty and the run status is consistent.
- **Effort:** 2 hours.

### 2.4 — Remove the global `app = create_app()` singleton
- **What:** `server.py` line 243 creates a module-level FastAPI instance.
- **Fix:** Move the instance behind a factory function that uvicorn calls (`mcp_watchtower.server:create_app`).
- **Acceptance:** Importing `server` no longer touches the filesystem (no SQLite path created).
- **Effort:** 2 hours.

---

## Phase 3 — Cross-Process Live Streaming (Week 5)

Today, the in-memory `EventBus` means the agent process and the UI server process can't share live events. This blocks the documented "run UI separately" workflow.

### 3.1 — SQLite polling fallback in the SSE stream
- **What:** When the SSE endpoint cannot find a bus subscriber match, fall back to polling `events` table by `(run_id, rowid > last_seen)` every 500 ms.
- **Files:** `server.py`, `storage.py`.
- **Acceptance:** Agent in process A → UI server in process B → browser shows live events with at most 500 ms latency.
- **Effort:** 2 days.

### 3.2 — Document the new workflow
- **What:** Update README "Using Watchtower With Your MCP Client" with two clearly-labeled modes:
  1. **In-process UI** (`ui=True`) — lowest latency.
  2. **Separate UI server** (`mcp-watchtower ui --db-path ...`) — ~500 ms event latency, works across processes.
- **Effort:** 2 hours.

---

## Phase 4 — Trust & Safety Hardening (Week 6)

### 4.1 — API token authentication
- **What:** When `WATCHTOWER_API_TOKEN` env var is set, require `Authorization: Bearer <token>` on all mutation endpoints.
- **Files:** `server.py`, `cli.py` (read env, pass to `create_app`).
- **Acceptance:** Without the header, `POST /api/approvals/*` returns 401. With it, works as before.
- **Effort:** 0.5 day.

### 4.2 — Argument-aware policy rules
- **What:** Let policies match on argument values, not just tool names.
- **Schema extension:**
  ```yaml
  rules:
    - match:
        server: filesystem
        tool: write_file
        arguments:
          path: "/etc/*"          # fnmatch on string args
      action: block
      risk: high
  ```
- **Files:** `safety.py` — extend `PolicyRule` and `classify_tool` to accept arguments.
- **Acceptance:** Test passing for "block writes to /etc/, allow writes to /tmp/" with the same `write_file` tool.
- **Effort:** 1.5 days.

### 4.3 — Event payload redaction
- **What:** Allow developers to redact sensitive fields before they hit SQLite.
- **API:**
  ```python
  Watchtower(
      redact_fields=["password", "api_key", "token", "secret"],
      redact_pattern=r"(?i)(api[_-]?key|token|secret|password)",
  )
  ```
- **Files:** new `mcp_watchtower/redaction.py`; called from `emitter.py` before persistence.
- **Acceptance:** A test that emits an event with `{"api_key": "sk-..."}` confirms the stored value is `"[REDACTED]"`.
- **Effort:** 1 day.

### 4.4 — Event type validation
- **What:** Define `KNOWN_EVENT_TYPES` and warn/error on unknown types.
- **Files:** `events.py` — add the frozenset; `normalize_event` raises `ValueError` on unknown types (with a `strict_events: bool = False` knob to demote to a warning).
- **Effort:** 0.5 day.

---

## Phase 5 — Distribution & Discoverability (Week 7)

### 5.1 — Publish to PyPI
- **Steps:**
  1. Reserve `mcp-watchtower` on PyPI and TestPyPI.
  2. Add `.github/workflows/release.yml` that builds and publishes on git tag `v*`.
  3. Use trusted publishing (no API tokens in secrets).
  4. Update `pyproject.toml` URLs to point at the real GitHub repo (`AnantBisht07/watchTower`).
- **Acceptance:** `pip install mcp-watchtower` works from a clean venv.
- **Effort:** 0.5 day.

### 5.2 — Docker image
- **What:** `Dockerfile` that runs the demo with zero local Python/Node setup.
- **Files:** `Dockerfile`, `docker-compose.yml` (optional).
- **Acceptance:** `docker run -p 8123:8123 ghcr.io/anantbisht07/watchtower demo` shows the UI.
- **Effort:** 1 day.

### 5.3 — Demo GIF in README
- **What:** A 30-second screen recording of the Safety Demo — approval appears, user clicks Approve, tool completes.
- **Tools:** `asciinema` for the CLI, `Kap`/`Cleanshot` for the browser.
- **Where:** Embed at the top of README, under the title.
- **Effort:** 0.5 day.

### 5.4 — Documentation site
- **What:** MkDocs site built from `docs/` and published to GitHub Pages.
- **Files:** `mkdocs.yml`, `.github/workflows/docs.yml`.
- **Acceptance:** `anantbisht07.github.io/watchTower` serves the docs with search.
- **Effort:** 1 day.

---

## Phase 6 — Ecosystem Integration (Weeks 8–9)

### 6.1 — OpenTelemetry export
- **What:** Optional exporter that maps Watchtower events to OTel spans.
  - `tool_call_started` → span begin
  - `tool_call_completed/failed/timeout` → span end with status
  - `approval_required` → span event
- **Files:** `mcp_watchtower/exporters/otel.py` (gated behind `[project.optional-dependencies].otel`).
- **Acceptance:** Spans show up in a local Jaeger instance run via Docker.
- **Effort:** 2 days.

### 6.2 — Langfuse / LangSmith export
- **What:** One-way export to popular LLM trace platforms.
- **Files:** `mcp_watchtower/exporters/langfuse.py`, `mcp_watchtower/exporters/langsmith.py`.
- **Acceptance:** A Langfuse project shows runs with the correct tool spans.
- **Effort:** 2 days.

### 6.3 — Webhook notifications
- **What:** On configured events (e.g., `approval_required`, `tool_call_rejected`), POST to a webhook.
- **Config:**
  ```python
  Watchtower(webhooks={"approval_required": "https://hooks.slack.com/..."})
  ```
- **Acceptance:** Slack incoming-webhook test receives a formatted message.
- **Effort:** 1 day.

### 6.4 — Reliability panel in the UI
- **What:** `/api/tools/reliability` data is collected but invisible. Add a panel.
- **Files:** `web/src/components/ReliabilityPanel.tsx`.
- **Acceptance:** UI shows a sortable table of `server.tool` with success rate, avg latency, last error.
- **Effort:** 1 day.

---

## Phase 7 — Production Readiness (Weeks 10–11)

### 7.1 — Schema versioning
- **What:** SQLite schema migrations so future column additions don't break existing databases.
- **Tool:** `alembic` is overkill — use a `schema_version` table and a small `migrations/` folder of SQL files.
- **Effort:** 1 day.

### 7.2 — Performance benchmarks
- **What:** A `bench/` folder measuring:
  - Events/sec single-process
  - SSE fan-out to N subscribers
  - SQLite write throughput
- **Output:** Published to docs site so users know the limits.
- **Effort:** 1 day.

### 7.3 — Run replay CLI
- **What:** `mcp-watchtower replay run_abc123` re-emits stored events to the UI (no real tool calls). Useful for demos and debugging.
- **Effort:** 1 day.

### 7.4 — Run export / import
- **What:** `mcp-watchtower export run_abc123 --format=jsonl > run.jsonl` and `mcp-watchtower import run.jsonl`.
- **Use case:** Share a problematic run with a maintainer via GitHub issue.
- **Effort:** 0.5 day.

### 7.5 — Multi-run / orchestrator support
- **What:** Decouple `Watchtower` from a single run; let one instance create many runs.
- **API:**
  ```python
  watchtower = Watchtower(app_name="orchestrator")
  with watchtower.run(task="subtask 1") as run:
      ...
  ```
- **Effort:** 2 days.

### 7.6 — Security model docs
- **What:** `docs/security.md` — threat model, what's protected, what isn't.
  - What an attacker on the local network can/cannot do
  - How redaction works and its limits
  - Why this is not a replacement for a production policy engine
- **Effort:** 0.5 day.

---

## Phase 8 — Adoption Push (Week 12)

### 8.1 — Real-world integration guides
- `docs/integrations/claude_desktop.md` — point Claude Desktop at a Watchtower-wrapped MCP config.
- `docs/integrations/cline.md` — Cline (VS Code) integration.
- `docs/integrations/cursor.md` — Cursor agent integration.
- `docs/integrations/openai_agents_sdk.md` — Use with OpenAI's Agents SDK.

### 8.2 — TypeScript / Node SDK (stretch)
- **What:** A minimal `@mcp-watchtower/node` package that emits events to the same SQLite database, for Node-based MCP clients.
- **Scope:** Event emission only — no UI, no policy engine. Defer those to the Python core.
- **Acceptance:** A Node agent can show up in the same Watchtower UI as a Python agent.
- **Effort:** 3 days.

### 8.3 — Launch checklist
- Write a Hacker News / r/LocalLLaMA / Twitter announcement.
- Submit to `awesome-mcp` lists.
- Open a discussion thread in the official MCP GitHub org.

---

## Cross-Cutting Concerns

These are not phase-specific — they run continuously.

| Area | Practice |
|---|---|
| Test coverage | Target ≥ 80% line coverage on `mcp_watchtower/`. Track in CI with `pytest-cov`. |
| Frontend coverage | At least one Playwright test per major UI state (idle, running, approval, rejected, completed). |
| Changelog | Maintain `CHANGELOG.md` using Keep-a-Changelog format. Updated on every PR. |
| Versioning | Strict semver. Pre-1.0 means breaking changes are allowed in minor versions but must be in the changelog. |
| Deprecation policy | Mark deprecated APIs with `DeprecationWarning`, document the migration, remove after one minor version. |
| Issue triage | Maintainer reviews new issues within 72 hours. Add `good-first-issue` and `help-wanted` labels liberally. |

---

## Explicitly Out of Scope (For Now)

To stay focused, the following are **not** on the v1.0 path:

- Multi-tenant SaaS / hosted version
- Postgres / multi-database support
- OAuth / SSO
- Cryptographic agent identity
- RBAC beyond a single API token
- LLM cost tracking (different problem; better tools exist)
- Internationalization of the UI
- Mobile app
- Self-hosted policy engine UI (YAML files are fine)
- Chain-of-thought reasoning viewer (out of scope per the original design doc)

Saying no to these keeps the project small enough to actually finish.

---

## Effort Summary

| Phase | Duration | Outcome |
|---|---|---|
| 0 — Hygiene | 1 week | CI, lint, types, community files |
| 1 — Real MCP integration | 2 weeks | Works with the actual `mcp` SDK |
| 2 — Fix broken APIs | 1 week | `ui=True` works, no polling, no orphaned approvals |
| 3 — Cross-process streaming | 1 week | UI server can run separately from agent |
| 4 — Safety hardening | 1 week | Auth, redaction, argument-aware policies |
| 5 — Distribution | 1 week | PyPI, Docker, docs site, demo GIF |
| 6 — Ecosystem integration | 2 weeks | OTel, Langfuse, webhooks, reliability panel |
| 7 — Production readiness | 2 weeks | Migrations, benchmarks, replay, multi-run |
| 8 — Adoption push | 1 week | Integration guides, optional TS SDK, launch |

**Total: ~12 weeks of focused work for a single developer**, or 6–7 weeks with two contributors. v0.2 (Phase 0–2) ships in 4 weeks and unlocks the first real users.

---

## Definition of Done — v1.0

A reasonable v1.0 is shipped when:

- [ ] `pip install mcp-watchtower` works from PyPI.
- [ ] `mcp` SDK adapter ships with three working examples (filesystem, GitHub, Claude Desktop integration).
- [ ] Approval gate works in-process AND across processes.
- [ ] All public APIs have docstrings; `mypy --strict` passes.
- [ ] CI runs on Linux + macOS + Windows × Python 3.11 + 3.12.
- [ ] Documentation site is live with search.
- [ ] README has a working demo GIF.
- [ ] Test coverage ≥ 80% on the Python core.
- [ ] Security model is documented.
- [ ] Three real-world integration guides exist.
- [ ] Changelog and semver are followed.
- [ ] At least one external contributor has merged a PR.

If all of these are checked, MCP Watchtower is no longer a 6/10 alpha — it is a 9/10 open source project that fills a real gap.
