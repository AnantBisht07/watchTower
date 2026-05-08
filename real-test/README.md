# Real Test: Toy MCP Server

This folder contains a self-contained real integration test for MCP Watchtower.

It starts an out-of-process MCP-style server over stdio, connects through a client adapter, wraps that client with Watchtower, runs read and write-like tool calls, approves the write, then starts the Watchtower UI server and verifies the API/UI-serving boundary.

Run from the repo root:

```bash
python real-test/run_watchtower_test.py
```

The test uses no external credentials and writes its local runtime database under:

```txt
real-test/.watchtower/watchtower.db
```
