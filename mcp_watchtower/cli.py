"""Command line entrypoints."""

from __future__ import annotations

import argparse


def main() -> None:
    parser = argparse.ArgumentParser(prog="mcp-watchtower")
    subparsers = parser.add_subparsers(dest="command")

    demo = subparsers.add_parser("demo", help="Start the local Watchtower demo server.")
    demo.add_argument("--host", default="127.0.0.1")
    demo.add_argument("--port", type=int, default=8000)
    demo.add_argument("--db-path")
    demo.add_argument("--reload", action="store_true")

    ui = subparsers.add_parser("ui", help="Start the Watchtower UI for an existing DB.")
    ui.add_argument("--host", default="127.0.0.1")
    ui.add_argument("--port", type=int, default=8000)
    ui.add_argument("--db-path", default=".watchtower/watchtower.db")
    ui.add_argument("--reload", action="store_true")

    args = parser.parse_args()
    if args.command in {"demo", "ui"}:
        import os
        import uvicorn

        if args.db_path:
            os.environ["WATCHTOWER_DB_PATH"] = args.db_path
        uvicorn.run(
            "mcp_watchtower.server:app",
            host=args.host,
            port=args.port,
            reload=args.reload,
        )
        return

    parser.print_help()


if __name__ == "__main__":
    main()
