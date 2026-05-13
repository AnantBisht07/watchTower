# Changelog

All notable changes to MCP Watchtower are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

### Added
- CI/CD pipeline via GitHub Actions (Python 3.11/3.12 × Ubuntu/macOS/Windows, frontend build, Playwright e2e)
- `mypy --strict` type checking added to CI and `pyproject.toml`
- `ruff lint` and `ruff format` enforcement in CI
- `pytest-cov` coverage tracking with 70% minimum threshold
- Community files: `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`
- GitHub issue templates (bug report, feature request) and PR template
- MCP SDK adapter (`mcp_watchtower/adapters/mcp_sdk.py`) for wrapping official `mcp.ClientSession`
- Filesystem reference example (`examples/mcp_sdk_filesystem/`)
- Async approval signaling via `asyncio.Event` — replaces 250 ms SQLite polling loop
- `Watchtower(ui=True)` now starts a background uvicorn server and prints the URL
- SQLite polling fallback in SSE stream for cross-process live event delivery
- API token authentication via `WATCHTOWER_API_TOKEN` environment variable
- Argument-aware policy rules — match on tool argument values, not just tool name
- Event payload redaction (`mcp_watchtower/redaction.py`) — strip secrets before SQLite
- `KNOWN_EVENT_TYPES` enum and validation in `normalize_event`
- `mcp` optional dependency group (`pip install mcp-watchtower[mcp]`)
- `httpx` added to dev dependencies for API testing
- Updated project URLs to `github.com/AnantBisht07/watchTower`

### Fixed
- Journey Demo emitted `run_completed` while an approval was still `waiting` — now auto-resolves after a delay
- `docs/architecture.md` had a trailing backtick in a section heading

### Changed
- `pyproject.toml`: removed duplicate `[tool.pytest.ini_options]` section
- `pyproject.toml`: added `asyncio_mode = "auto"` so async tests run without manual `asyncio.run()`
- README quickstart now shows macOS/Linux commands first, Windows second

---

## [0.1.0] — 2026-05-13

### Added
- Initial release
- Live browser UI for MCP agent runs (React + Vite)
- Server-Sent Events stream for real-time event delivery
- SQLite audit trail (5 tables: runs, events, mcp_servers, approvals, mcp_tool_stats)
- In-memory async event bus (`EventBus`)
- `WatchtowerMCPClient` transparent proxy with full tool lifecycle tracking
- `SafetyPolicy` — YAML-configurable, wildcard rule engine (allow / require_approval / block)
- `HealthChecker` — async MCP server health checks with latency measurement
- Tool reliability counters (success/failure/timeout counts, average latency)
- FastAPI backend with approval endpoints
- Built-in Journey Demo and Safety Demo
- `Watchtower` SDK entry point
- MIT license
