# MCP Watchtower — Codebase Analysis

This document is a full technical review of the MCP Watchtower codebase: what is well-built, where the gaps are, how effective the project is as an open source tool, and what should be improved.

---

## What Was Built

MCP Watchtower is a **local-first runtime observation and control layer** that sits between an AI agent and MCP servers. It intercepts tool calls, records every event in SQLite, streams them live to a React UI over SSE, and gates risky tool calls behind human approval.

---

## Strong Foundations

### 1. Architecture is clean and well-separated

Every responsibility has exactly one owner:

| Module | Responsibility |
|---|---|
| `mcp_watchtower/events.py` | Normalized event schema, validation, ID generation |
| `mcp_watchtower/emitter.py` | Normalize → persist → publish pipeline |
| `mcp_watchtower/bus.py` | In-memory async pub/sub for live SSE feeds |
| `mcp_watchtower/storage.py` | SQLite with 5 tables, RLock for thread safety |
| `mcp_watchtower/mcp_wrapper.py` | Transparent proxy with full lifecycle tracking |
| `mcp_watchtower/safety.py` | YAML/code rule engine with wildcard matching |
| `mcp_watchtower/health.py` | Async health checks with timeout and latency |
| `mcp_watchtower/server.py` | FastAPI REST + SSE + SPA serving |
| `mcp_watchtower/watchtower.py` | Single SDK entry point that wires everything |

The layering is correct: `Watchtower → Emitter → (Store + Bus) ← SSE Server`. No circular imports, no shared globals between layers (except one issue noted below).

### 2. Event model is well-designed

- Events have `event_id`, `run_id`, `parent_event_id` for causal linking.
- `type`, `status`, `message` are always required; everything else is optional.
- `raw_json` is stored alongside indexed columns — full fidelity, fast queries.
- Tool lifecycle is complete: `requested → started → completed/failed/timeout`.
- Approval lifecycle is complete: `approval_required → approved/rejected → tool_call_approved/rejected`.

The design document and implementation are in close alignment — the spec was clearly followed.

### 3. Safety policy is genuinely useful

- First-rule-wins, YAML-configurable, fnmatch wildcards on server + tool.
- Three action types: `allow`, `require_approval`, `block`.
- Default rules cover the most common dangerous patterns (`*delete*`, `*remove*`, `*write*`, `*send*`, `*create*`).
- Loading from file or dict is tested.

### 4. Tests cover the important contracts

The test suite tests observable behavior, not implementation details:

- Does approval actually pause the tool call before the client is invoked? Yes.
- Does rejection skip the underlying call? Yes.
- Does blocking happen synchronously? Yes.
- Does the server API persist decisions and emit follow-up events? Yes.
- Does the wrapper support both positional and keyword-style MCP clients? Yes.

### 5. Developer SDK experience is clear

```python
watchtower = Watchtower(app_name="my-agent", safety=True)
github = watchtower.wrap_mcp_client(raw_client, server_name="github")
result = await github.call_tool("search_issues", {...})
```

That is a one-minute integration story.

---

## Open Source Effectiveness Rating: 6 / 10

The idea is genuinely differentiated (live approval gates + flight recorder + health panel in one local tool), the architecture is sound, and the documentation is better than most early-stage projects. But there are problems that would stop most developers from actually using it.

---

## What Is Missing or Broken

### Critical — blocks real-world use

**1. No integration with the real MCP Python SDK.**

`WatchtowerMCPClient` wraps any object with a `call_tool` method but does not provide an adapter for the official `mcp` package's `ClientSession`. The examples use a fake client. A developer using `mcp.ClientSession` has no example of how to plug it in. This is the number one adoption blocker.

**2. `Watchtower(ui=True)` does nothing.**

The `ui` parameter is accepted in `watchtower.py` but never acted on — no server is started. A developer who sets `ui=True` expecting a browser to open will see nothing. This is a misleading API.

**3. Approval polling is a busy-wait loop.**

`mcp_wrapper.py` polls SQLite every 250 ms. Over the 300-second default timeout that is 1,200 database reads per pending approval. This should use `asyncio.Event` keyed by `approval_id`, signaled from `EventEmitter.emit()` when the approval fires.

**4. EventBus is in-memory, binding agent and UI to the same process.**

If someone runs the agent in a script and the UI server separately (which the README implies is valid with `--db-path`), live streaming does not work — the server's `EventBus` is empty. The README's "Using Watchtower With Your MCP Client" section implies running the CLI separately, but that setup cannot receive live events.

**5. Not on PyPI.**

`pyproject.toml` points to a GitHub URL that does not exist yet. `pip install mcp-watchtower` fails. Until published, the install story requires cloning the repo.

---

### Significant — hurts quality and trust

**6. Global singleton `app = create_app()` in server.py.**

A module-level `app` instance is created on import. Any test that imports `server` potentially touches the global runtime. Tests work around this by calling `create_app(runtime)` explicitly, but the singleton stays and confuses contributors.

**7. No authentication on approval endpoints.**

`POST /api/approvals/{id}/approve` has no token check. On a shared dev machine or networked environment, anyone can approve or reject tool calls.

**8. `classify_tool` ignores arguments.**

`del arguments` discards all argument data. Policies cannot express "block writes to `/etc/` but allow writes to `/tmp/`" — a very common real-world requirement.

**9. Windows-centric quickstart.**

`npm.cmd`, `.\.venv\Scripts\activate`, `npx.cmd` — the README quickstart only shows Windows PowerShell commands. macOS and Linux developers (the majority of the open source audience) have to mentally translate every command.

**10. Event type is not validated against a known set.**

`normalize_event` checks for `type`, `status`, `message` presence but does not validate that `type` is a known event type. A typo like `"tool_call_compelted"` silently persists and the UI silently drops it.

---

### Moderate — limits reach and ecosystem fit

**11. No OpenTelemetry or Langfuse export.**

The target audience often already has an observability stack. There is no export path to OTel spans or Langfuse/LangSmith traces.

**12. Tool stats table is not surfaced in the UI.**

`list_tool_reliability()` exists and the API returns it, but the React UI has no reliability panel. The data is collected but invisible.

**13. One run per `Watchtower` instance.**

A run is created at construction time. Multi-agent or multi-step scenarios need a new `Watchtower` per run.

**14. No retry or graceful degradation.**

If the underlying MCP call times out, `WatchtowerMCPClient` re-raises with no retry policy, circuit breaker, or fallback hook.

**15. Demo run has an unresolved approval bug.**

`fake_runner.py` emits `approval_required` but then immediately emits `run_completed` — the approval is never resolved. The Journey Demo shows an approval hanging while the run says "Completed".

---

## Specific Improvements to Make

Listed in priority order:

**1. Ship a real MCP SDK adapter.**

Add `mcp_watchtower/adapters/mcp_sdk.py` with a `wrap_mcp_session(session: mcp.ClientSession, ...) -> WatchtowerMCPClient` helper, and one working example in `examples/` using the official `mcp` package.

**2. Replace approval polling with async signaling.**

```python
# EventEmitter.emit() — after persisting:
if event["type"] in {"tool_call_approved", "tool_call_rejected"} and event.get("approval_id"):
    self.bus.signal_approval(event["approval_id"], event["status"])

# WatchtowerMCPClient._wait_for_approval():
await self._emitter.bus.wait_for_approval(approval_id, timeout=self._approval_timeout_s)
```

**3. Implement or remove `ui=True`.**

Either start a background uvicorn thread when `ui=True` and print the URL, or remove the parameter until that is built. Misleading APIs erode trust fast.

**4. Fix the Journey Demo's unresolved approval.**

Either resolve the approval automatically after a delay in `run_fake_journey`, or do not emit `run_completed` while an approval is still `waiting`.

**5. Add argument-aware policy matching.**

Extend `PolicyRule` with an optional `arguments` matcher so policies can express "block writes where `path` starts with `/etc`".

**6. Add API token auth.**

Read `WATCHTOWER_API_TOKEN` from the environment; if set, require `Authorization: Bearer <token>` on all `POST` endpoints.

**7. Publish to PyPI.**

Run `python -m build && twine upload dist/*` and make `pip install mcp-watchtower` work.

**8. Cross-platform README.**

Show Unix commands (`source .venv/bin/activate`, `npm run build`) first, with PowerShell equivalents noted.

**9. Add event type enum and validation.**

Define `KNOWN_EVENT_TYPES: frozenset[str]` in `events.py` and warn in `normalize_event` when an unknown type is emitted.

**10. Surface tool reliability in the UI.**

Add a reliability panel to the React UI that reads from `/api/tools/reliability` — the data is already there, just not visible.

---

## Summary

MCP Watchtower has a genuinely good idea, a well-thought-out architecture, a clean event model, and honest scoping. The core pipeline — wrap → intercept → emit → persist → stream → UI — is implemented correctly end-to-end. The safety policy is simple but actually useful.

The project is **not ready for mainstream open source adoption today** because: (a) there is no real MCP SDK adapter, (b) `ui=True` is broken, (c) approval polling burns resources, and (d) it is not on PyPI.

Fix those four things and this becomes a legitimately useful tool that fills a gap no current open source project addresses well — live, interactive, human-in-the-loop control for MCP agent execution.

The final vision is correct:

> Agents should not be black boxes. MCP Watchtower makes them visible, controllable, and reliable.

The gap between that vision and the current state is roughly two focused development sprints.
