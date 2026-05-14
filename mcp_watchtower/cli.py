"""Command line entrypoints."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(prog="mcp-watchtower")
    subparsers = parser.add_subparsers(dest="command")

    demo = subparsers.add_parser("demo", help="Start the local Watchtower demo server.")
    demo.add_argument("--host", default="127.0.0.1")
    demo.add_argument("--port", type=int, default=8000)
    demo.add_argument("--db-path")

    ui = subparsers.add_parser("ui", help="Start the Watchtower UI for an existing DB.")
    ui.add_argument("--host", default="127.0.0.1")
    ui.add_argument("--port", type=int, default=8000)
    ui.add_argument("--db-path", default=".watchtower/watchtower.db")

    replay_p = subparsers.add_parser("replay", help="Print all events for a run.")
    replay_p.add_argument("run_id", help="Run ID to replay")
    replay_p.add_argument("--db-path", default=".watchtower/watchtower.db")
    replay_p.add_argument("--json", action="store_true", dest="as_json", help="Output raw JSON")

    export_p = subparsers.add_parser("export", help="Export a run and its events to JSON.")
    export_p.add_argument("run_id", nargs="?", help="Run ID to export (default: most recent)")
    export_p.add_argument("--db-path", default=".watchtower/watchtower.db")
    export_p.add_argument("--output", "-o", help="Output file (default: stdout)")

    import_p = subparsers.add_parser("import", help="Import a previously exported run JSON.")
    import_p.add_argument("file", help="JSON file produced by 'mcp-watchtower export'")
    import_p.add_argument("--db-path", default=".watchtower/watchtower.db")

    args = parser.parse_args()

    if args.command in {"demo", "ui"}:
        _serve(args)
        return

    if args.command == "replay":
        _replay(args)
        return

    if args.command == "export":
        _export(args)
        return

    if args.command == "import":
        _import(args)
        return

    parser.print_help()


# ── server commands ──────────────────────────────────────────────────────────

def _serve(args: argparse.Namespace) -> None:
    try:
        import uvicorn
    except ImportError:
        raise SystemExit(
            "Server dependencies are missing.\n"
            'Install with: pip install mcp-watchtower[server]'
        )

    from .server import WatchtowerRuntime, create_app

    db_path = getattr(args, "db_path", None)
    runtime = WatchtowerRuntime(db_path or os.environ.get("WATCHTOWER_DB_PATH"))
    app = create_app(runtime)

    print(f"Watchtower UI: http://{args.host}:{args.port}/")
    uvicorn.run(app, host=args.host, port=args.port)


# ── replay command ───────────────────────────────────────────────────────────

def _replay(args: argparse.Namespace) -> None:
    from .storage import SQLiteStore

    store = SQLiteStore(args.db_path)
    run = store.get_run(args.run_id)
    if run is None:
        raise SystemExit(f"Run not found: {args.run_id}")

    events = store.list_events(args.run_id)

    if args.as_json:
        json.dump({"run": run, "events": events}, sys.stdout, indent=2)
        print()
        return

    print(f"Run {run['run_id']}  app={run['app_name']}  status={run['status']}")
    print(f"  started:  {run['started_at']}")
    if run.get("completed_at"):
        print(f"  finished: {run['completed_at']}")
    print(f"  task:     {run.get('task') or '—'}")
    print()

    for event in events:
        ts = event.get("timestamp", "")[:19]
        etype = event.get("type", "")
        msg = event.get("message", "")
        server = event.get("server", "")
        tool = event.get("tool", "")
        tool_label = f"  [{server}.{tool}]" if server and tool else (f"  [{tool}]" if tool else "")
        latency = event.get("latency_ms")
        lat_label = f"  {latency}ms" if latency is not None else ""
        print(f"  {ts}  {etype:<30}{tool_label}{lat_label}")
        if msg:
            print(f"            {msg}")


# ── export command ───────────────────────────────────────────────────────────

def _export(args: argparse.Namespace) -> None:
    from .storage import SQLiteStore

    store = SQLiteStore(args.db_path)

    if args.run_id:
        run = store.get_run(args.run_id)
        if run is None:
            raise SystemExit(f"Run not found: {args.run_id}")
    else:
        runs = store.list_runs(limit=1)
        if not runs:
            raise SystemExit("No runs found in database.")
        run = runs[0]

    events = store.list_events(run["run_id"])
    payload = {
        "watchtower_export_version": 1,
        "run": run,
        "events": events,
    }

    if args.output:
        Path(args.output).write_text(json.dumps(payload, indent=2))
        print(f"Exported {len(events)} events for run {run['run_id']} → {args.output}")
    else:
        json.dump(payload, sys.stdout, indent=2)
        print()


# ── import command ───────────────────────────────────────────────────────────

def _import(args: argparse.Namespace) -> None:
    from .storage import SQLiteStore

    raw = Path(args.file).read_text()
    payload = json.loads(raw)

    version = payload.get("watchtower_export_version", 0)
    if version != 1:
        raise SystemExit(f"Unsupported export version: {version}")

    run: dict = payload["run"]
    events: list[dict] = payload["events"]

    store = SQLiteStore(args.db_path)

    existing = store.get_run(run["run_id"])
    if existing is not None:
        raise SystemExit(
            f"Run {run['run_id']} already exists in {args.db_path}. "
            "Delete it first or use a different --db-path."
        )

    with store._lock:
        store._conn.execute(
            """
            insert into runs(run_id, app_name, task, status, started_at, completed_at)
            values (?, ?, ?, ?, ?, ?)
            """,
            (
                run["run_id"],
                run["app_name"],
                run.get("task"),
                run["status"],
                run["started_at"],
                run.get("completed_at"),
            ),
        )
        store._conn.commit()

    skipped = 0
    for event in events:
        try:
            store.append_event(event)  # type: ignore[arg-type]
        except Exception:
            skipped += 1

    print(
        f"Imported run {run['run_id']}: "
        f"{len(events) - skipped} events written"
        + (f", {skipped} skipped (duplicates)" if skipped else "")
    )


if __name__ == "__main__":
    main()
