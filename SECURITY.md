# Security Policy

## Supported Versions

MCP Watchtower is currently in alpha. Only the latest version on the `main` branch receives security fixes.

| Version | Supported |
|---|---|
| 0.1.x (main) | Yes |

## What This Tool Is and Is Not

MCP Watchtower is a **local-first developer tool**. It is designed for use on a single developer machine or a trusted local network.

**It is not:**
- A production security gateway
- A replacement for network-level access controls
- An enterprise policy enforcement engine with audit guarantees

**Known security boundaries:**
- The API has no authentication by default. Anyone on the same network can call approval endpoints. Set `WATCHTOWER_API_TOKEN` to enable Bearer token protection on mutation endpoints.
- SQLite is stored locally at `.watchtower/watchtower.db`. Secure it with filesystem permissions if the machine is shared.
- Tool input arguments are recorded verbatim. Use `redact_fields` on the `Watchtower` constructor to avoid persisting secrets.
- There is no TLS on the local server. Do not expose the port to the public internet without a reverse proxy.

## Reporting a Vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Instead, report vulnerabilities by emailing the maintainer or opening a [private security advisory](https://github.com/AnantBisht07/watchTower/security/advisories/new) on GitHub.

Include:
- A description of the vulnerability and its potential impact
- Steps to reproduce
- Any suggested fix or mitigation

You will receive an acknowledgement within 72 hours and a fix timeline within 7 days for confirmed issues.
