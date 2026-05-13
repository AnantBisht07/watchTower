# Contributing to MCP Watchtower

Thanks for considering a contribution. This document covers how to set up the project, what to work on, and how to submit a pull request.

---

## Development Setup

### Requirements

- Python 3.11 or 3.12
- Node 20+
- Git

### macOS / Linux

```bash
git clone https://github.com/AnantBisht07/watchTower.git
cd watchTower

python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev,server]"

cd web
npm install
cd ..
```

### Windows (PowerShell)

```powershell
git clone https://github.com/AnantBisht07/watchTower.git
cd watchTower

python -m venv .venv
.\.venv\Scripts\activate
python -m pip install -e ".[dev,server]"

cd web
npm.cmd install
cd ..
```

---

## Running Tests

```bash
# Python tests
pytest

# Python tests with coverage
pytest --cov

# Type checking
mypy mcp_watchtower/

# Lint
ruff check .
ruff format --check .
```

```bash
# Frontend build
cd web && npm run build

# Playwright end-to-end
cd web && npx playwright test
```

All of these run automatically in CI on every pull request.

---

## Running the Dev Server

```bash
# Start the Python backend with a demo run
python -m mcp_watchtower.cli demo --port 8000

# In a second terminal, start the React dev server
cd web && npm run dev
```

Open `http://127.0.0.1:5173/` — Vite proxies `/api` to the Python server on `8000`.

---

## Project Layout

```
mcp_watchtower/     Python SDK + FastAPI server
web/src/            React control tower UI
tests/              Python unit and integration tests
web/tests/          Playwright end-to-end tests
docs/               Architecture, event model, policies, analysis
examples/           Runnable example scripts
```

---

## Branch and PR Conventions

- Branch from `main`: `git checkout -b feat/my-feature` or `fix/my-bug`.
- Keep PRs focused — one feature or fix per PR.
- Write a clear title and description that explains *why*, not just *what*.
- Link any related issue with `Closes #N`.
- All CI checks must pass before merging.

---

## Commit Style

Follow the [Conventional Commits](https://www.conventionalcommits.org/) format:

```
feat: add async approval signaling
fix: resolve orphaned approval in journey demo
docs: add cross-platform quickstart
refactor: remove global server singleton
test: cover argument-aware policy matching
chore: add mypy to CI
```

---

## What to Work On

Check the [issue tracker](https://github.com/AnantBisht07/watchTower/issues) for issues tagged:

- `good-first-issue` — small, well-defined tasks
- `help-wanted` — medium tasks where maintainer input is welcome
- `bug` — confirmed bugs with reproduction steps

The [improvement plan](docs/improvement_plan.md) lists every planned phase with effort estimates and acceptance criteria.

---

## Code Style

- Python: `ruff` for lint and format, `mypy --strict` for types.
- TypeScript: standard Vite/React project conventions.
- No comments that describe *what* the code does — only *why* something non-obvious is done.
- No half-finished implementations. If something is incomplete, open an issue instead.

---

## Reporting Bugs

Use the [bug report template](.github/ISSUE_TEMPLATE/bug_report.yml).

Please include:
- Python version and OS
- How you installed the package
- Exact error message and stack trace
- Minimal reproduction script if possible

---

## Asking Questions

Open a [GitHub Discussion](https://github.com/AnantBisht07/watchTower/discussions) for questions, ideas, or feedback. Issues are for confirmed bugs and tracked feature requests.

---

## License

By contributing, you agree that your changes will be licensed under the [MIT License](LICENSE).
