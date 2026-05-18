"""SQLite persistence for runs, events, service health, and approvals."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from threading import RLock
from typing import Any

from .events import EventDict, new_id, utc_now_iso


_MIGRATIONS: list[str] = [
    # v1 — baseline schema (tables that existed before versioning was added)
    """
    create table if not exists runs (
        run_id text primary key,
        app_name text not null,
        task text,
        status text not null,
        started_at text not null,
        completed_at text
    );
    create table if not exists events (
        event_id text primary key,
        run_id text not null,
        parent_event_id text,
        type text not null,
        timestamp text not null,
        status text not null,
        message text not null,
        server text,
        transport text,
        tool text,
        latency_ms integer,
        risk text,
        approval_id text,
        input_json text,
        output_summary_json text,
        error_json text,
        metadata_json text not null,
        raw_json text not null,
        foreign key(run_id) references runs(run_id)
    );
    create index if not exists idx_events_run_time
        on events(run_id, timestamp, event_id);
    create table if not exists mcp_servers (
        server text primary key,
        run_id text,
        status text not null,
        tools_count integer not null default 0,
        latency_ms integer,
        last_checked_at text,
        last_error text
    );
    create table if not exists approvals (
        approval_id text primary key,
        run_id text not null,
        event_id text,
        status text not null,
        risk text,
        reason text,
        decision text,
        decided_at text,
        created_at text not null
    );
    create table if not exists mcp_tool_stats (
        server text not null,
        tool text not null,
        success_count integer not null default 0,
        failure_count integer not null default 0,
        timeout_count integer not null default 0,
        total_latency_ms integer not null default 0,
        last_latency_ms integer,
        last_status text,
        last_error text,
        last_called_at text,
        primary key(server, tool)
    );
    """,
    # v2 — add reason column to events (if not already present via raw_json)
    "select 1;",  # placeholder — extend here for future schema changes
]


class SQLiteStore:
    def __init__(self, db_path: str | Path | None = None) -> None:
        self.db_path = Path(db_path or ".watchtower/watchtower.db")
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = RLock()
        self._conn = sqlite3.connect(self.db_path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._init_schema()

    def close(self) -> None:
        with self._lock:
            self._conn.close()

    def _current_version(self) -> int:
        try:
            row = self._conn.execute(
                "select version from schema_version order by version desc limit 1"
            ).fetchone()
            return int(row[0]) if row else 0
        except sqlite3.OperationalError:
            return 0

    def _init_schema(self) -> None:
        with self._lock:
            self._conn.execute(
                """
                create table if not exists schema_version (
                    version integer primary key,
                    applied_at text not null
                )
                """
            )
            self._conn.commit()

            current = self._current_version()
            for idx, migration_sql in enumerate(_MIGRATIONS):
                version = idx + 1
                if version <= current:
                    continue
                self._conn.executescript(migration_sql)
                self._conn.execute(
                    "insert or ignore into schema_version(version, applied_at) values (?, ?)",
                    (version, utc_now_iso()),
                )
                self._conn.commit()

    def schema_version(self) -> int:
        with self._lock:
            return self._current_version()

    def create_run(self, app_name: str, task: str | None = None) -> dict[str, Any]:
        run_id = new_id("run")
        now = utc_now_iso()
        with self._lock:
            self._conn.execute(
                """
                insert into runs(run_id, app_name, task, status, started_at)
                values (?, ?, ?, ?, ?)
                """,
                (run_id, app_name, task, "running", now),
            )
            self._conn.commit()
        return {
            "run_id": run_id,
            "app_name": app_name,
            "task": task,
            "status": "running",
            "started_at": now,
            "completed_at": None,
        }

    def update_run_status(self, run_id: str, status: str) -> None:
        completed_at = utc_now_iso() if status in {"completed", "failed"} else None
        with self._lock:
            self._conn.execute(
                """
                update runs
                   set status = ?,
                       completed_at = coalesce(?, completed_at)
                 where run_id = ?
                """,
                (status, completed_at, run_id),
            )
            self._conn.commit()

    def get_run(self, run_id: str) -> dict[str, Any] | None:
        with self._lock:
            row = self._conn.execute("select * from runs where run_id = ?", (run_id,)).fetchone()
        return dict(row) if row else None

    def list_runs(self, limit: int = 50) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._conn.execute(
                "select * from runs order by started_at desc limit ?", (limit,)
            ).fetchall()
        return [dict(row) for row in rows]

    def append_event(self, event: EventDict) -> None:
        raw_json = json.dumps(event, sort_keys=True)
        with self._lock:
            self._conn.execute(
                """
                insert into events(
                    event_id, run_id, parent_event_id, type, timestamp, status, message,
                    server, transport, tool, latency_ms, risk, approval_id, input_json,
                    output_summary_json, error_json, metadata_json, raw_json
                )
                values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    event["event_id"],
                    event["run_id"],
                    event.get("parent_event_id"),
                    event["type"],
                    event["timestamp"],
                    event["status"],
                    event["message"],
                    event.get("server"),
                    event.get("transport"),
                    event.get("tool"),
                    event.get("latency_ms"),
                    event.get("risk"),
                    event.get("approval_id"),
                    json.dumps(event.get("input")) if "input" in event else None,
                    json.dumps(event.get("output_summary"))
                    if "output_summary" in event
                    else None,
                    json.dumps(event.get("error")) if "error" in event else None,
                    json.dumps(event.get("metadata") or {}),
                    raw_json,
                ),
            )
            self._conn.commit()

    def list_events(self, run_id: str, limit: int = 500) -> list[EventDict]:
        with self._lock:
            rows = self._conn.execute(
                """
                select raw_json from events
                 where run_id = ?
                 order by rowid asc
                 limit ?
                """,
                (run_id, limit),
            ).fetchall()
        return [json.loads(row["raw_json"]) for row in rows]

    def list_events_after(self, run_id: str, seen_ids: set[str]) -> list[EventDict]:
        """Return events for run_id whose event_id is not in seen_ids.

        Used by the cross-process SSE fallback to detect rows written by another process.
        """
        with self._lock:
            rows = self._conn.execute(
                """
                select raw_json from events
                 where run_id = ?
                 order by rowid asc
                """,
                (run_id,),
            ).fetchall()
        return [
            json.loads(row["raw_json"])
            for row in rows
            if json.loads(row["raw_json"]).get("event_id") not in seen_ids
        ]

    def get_latest_server_metadata(self, server: str) -> dict[str, Any]:
        with self._lock:
            rows = self._conn.execute(
                """
                select raw_json from events
                 where server = ?
                 order by rowid desc
                 limit 50
                """,
                (server,),
            ).fetchall()
        for row in rows:
            event = json.loads(row["raw_json"])
            metadata = event.get("metadata") or {}
            server_metadata = metadata.get("server_metadata")
            if isinstance(server_metadata, dict):
                return server_metadata
        return {}

    def get_event_by_approval_id(self, approval_id: str) -> EventDict | None:
        with self._lock:
            row = self._conn.execute(
                """
                select raw_json from events
                 where approval_id = ?
                 order by rowid asc
                 limit 1
                """,
                (approval_id,),
            ).fetchone()
        return json.loads(row["raw_json"]) if row else None

    def upsert_server_health(self, health: dict[str, Any]) -> None:
        with self._lock:
            self._conn.execute(
                """
                insert into mcp_servers(
                    server, run_id, status, tools_count, latency_ms, last_checked_at, last_error
                )
                values (?, ?, ?, ?, ?, ?, ?)
                on conflict(server) do update set
                    run_id = excluded.run_id,
                    status = excluded.status,
                    tools_count = excluded.tools_count,
                    latency_ms = excluded.latency_ms,
                    last_checked_at = excluded.last_checked_at,
                    last_error = excluded.last_error
                """,
                (
                    health["server"],
                    health.get("run_id"),
                    health["status"],
                    health.get("tools_count", 0),
                    health.get("latency_ms"),
                    health.get("last_checked_at"),
                    health.get("last_error"),
                ),
            )
            self._conn.commit()

    def list_server_health(self) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._conn.execute("select * from mcp_servers order by server asc").fetchall()
        return [dict(row) for row in rows]

    def create_approval(
        self,
        run_id: str,
        approval_id: str,
        event_id: str | None = None,
        risk: str | None = None,
        reason: str | None = None,
    ) -> dict[str, Any]:
        now = utc_now_iso()
        with self._lock:
            self._conn.execute(
                """
                insert into approvals(
                    approval_id, run_id, event_id, status, risk, reason, created_at
                )
                values (?, ?, ?, ?, ?, ?, ?)
                on conflict(approval_id) do nothing
                """,
                (approval_id, run_id, event_id, "waiting", risk, reason, now),
            )
            self._conn.commit()
        approval = self.get_approval(approval_id)
        if approval is None:
            raise RuntimeError(f"approval was not created: {approval_id}")
        return approval

    def get_approval(self, approval_id: str) -> dict[str, Any] | None:
        with self._lock:
            row = self._conn.execute(
                "select * from approvals where approval_id = ?", (approval_id,)
            ).fetchone()
        return dict(row) if row else None

    def list_approvals(self, run_id: str | None = None) -> list[dict[str, Any]]:
        with self._lock:
            if run_id:
                rows = self._conn.execute(
                    "select * from approvals where run_id = ? order by created_at desc",
                    (run_id,),
                ).fetchall()
            else:
                rows = self._conn.execute(
                    "select * from approvals order by created_at desc"
                ).fetchall()
        return [dict(row) for row in rows]

    def decide_approval(self, approval_id: str, decision: str) -> tuple[dict[str, Any] | None, bool]:
        if decision not in {"approved", "rejected"}:
            raise ValueError("decision must be approved or rejected")

        with self._lock:
            existing = self._conn.execute(
                "select * from approvals where approval_id = ?", (approval_id,)
            ).fetchone()
            if existing is None:
                return None, False

            existing_dict = dict(existing)
            if existing_dict["status"] != "waiting":
                return existing_dict, False

            self._conn.execute(
                """
                update approvals
                   set status = ?,
                       decision = ?,
                       decided_at = ?
                 where approval_id = ?
                """,
                (decision, decision, utc_now_iso(), approval_id),
            )
            self._conn.commit()

            updated = self._conn.execute(
                "select * from approvals where approval_id = ?", (approval_id,)
            ).fetchone()
        return dict(updated), True

    def record_tool_event(self, event: EventDict) -> None:
        if event["type"] not in {"tool_call_completed", "tool_call_failed", "tool_call_timeout"}:
            return

        server = event.get("server") or "unknown"
        tool = event.get("tool") or "unknown"
        latency_ms = int(event.get("latency_ms") or 0)
        success_increment = 1 if event["type"] == "tool_call_completed" else 0
        failure_increment = 1 if event["type"] == "tool_call_failed" else 0
        timeout_increment = 1 if event["type"] == "tool_call_timeout" else 0
        last_error = None
        if event["type"] != "tool_call_completed":
            error = event.get("error")
            last_error = json.dumps(error) if error is not None else event.get("message")

        with self._lock:
            self._conn.execute(
                """
                insert into mcp_tool_stats(
                    server, tool, success_count, failure_count, timeout_count,
                    total_latency_ms, last_latency_ms, last_status, last_error, last_called_at
                )
                values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                on conflict(server, tool) do update set
                    success_count = success_count + excluded.success_count,
                    failure_count = failure_count + excluded.failure_count,
                    timeout_count = timeout_count + excluded.timeout_count,
                    total_latency_ms = total_latency_ms + excluded.total_latency_ms,
                    last_latency_ms = excluded.last_latency_ms,
                    last_status = excluded.last_status,
                    last_error = excluded.last_error,
                    last_called_at = excluded.last_called_at
                """,
                (
                    server,
                    tool,
                    success_increment,
                    failure_increment,
                    timeout_increment,
                    latency_ms,
                    latency_ms if "latency_ms" in event else None,
                    event["status"],
                    last_error,
                    event["timestamp"],
                ),
            )
            self._conn.commit()

    def list_recent_events(self, limit: int = 30) -> list[EventDict]:
        """Return the most recent events across all runs, oldest first."""
        with self._lock:
            rows = self._conn.execute(
                "select raw_json from events order by rowid desc limit ?",
                (limit,),
            ).fetchall()
        return [json.loads(row["raw_json"]) for row in reversed(rows)]

    def list_tool_reliability(self) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._conn.execute(
                """
                select
                    server,
                    tool,
                    success_count,
                    failure_count,
                    timeout_count,
                    total_latency_ms,
                    last_latency_ms,
                    last_status,
                    last_error,
                    last_called_at,
                    case
                        when (success_count + failure_count + timeout_count) = 0 then 0
                        else cast(total_latency_ms as real) /
                             (success_count + failure_count + timeout_count)
                    end as avg_latency_ms
                  from mcp_tool_stats
                 order by last_called_at desc, server asc, tool asc
                """
            ).fetchall()
        return [dict(row) for row in rows]
