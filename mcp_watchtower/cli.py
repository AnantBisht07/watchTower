"""Command line entrypoints."""

from __future__ import annotations

import argparse
import os


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

    args = parser.parse_args()

    if args.command in {"demo", "ui"}:
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
        return

    parser.print_help()


if __name__ == "__main__":
    main()
