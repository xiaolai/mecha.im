---
title: Environment Variables
description: All environment variables recognized by the Mecha runtime.
---

# Environment Variables

All environment variables recognized by Mecha.

## Authentication

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Anthropic API key for agent inference. Takes precedence over auth profiles. |
| `CLAUDE_CODE_OAUTH_TOKEN` | OAuth token for Claude Code. Preferred over API keys (longer lifespan). |

## Debugging

| Variable | Description |
|----------|-------------|
| `MECHA_LOG_LEVEL` | Log verbosity: `debug`, `info`, `warn`, or `error`. Defaults to `info`. |
| `MECHA_OTP` | TOTP secret supplied via environment (alternative to file-based storage). Useful for CI, containers, and automated deployments. |

## Discovery

| Variable | Description |
|----------|-------------|
| `MECHA_CLUSTER_KEY` | Shared secret for auto-discovery. When set, nodes on the same Tailscale network automatically find and register each other via `POST /discover/handshake`. Nodes without this key ignore discovery requests. |

## Directories

| Variable | Description |
|----------|-------------|
| `MECHA_DIR` | Override the default `~/.mecha/` directory for all state and configuration. |

## Internal (Set by Runtime)

These are set automatically when a bot process starts. Do not set manually.

| Variable | Description |
|----------|-------------|
| `MECHA_BOT_NAME` | Name of the current bot |
| `MECHA_PORT` | Port the bot runtime listens on |
| `MECHA_WORKSPACE` | Path to the bot's workspace |
| `MECHA_PROJECTS_DIR` | Workspace-specific projects directory inside the bot |
| `MECHA_AUTH_TOKEN` | Bearer token for the bot API |
| `MECHA_LOG_DIR` | Path to the bot's log directory |
| `MECHA_SANDBOX_ROOT` | Path to the bot's root directory |

## Example `.env` File

```bash
# Authentication
ANTHROPIC_API_KEY=sk-ant-...
CLAUDE_CODE_OAUTH_TOKEN=eyJ...

# Auto-discovery (optional)
MECHA_CLUSTER_KEY=my-shared-secret

# Debugging (optional)
MECHA_LOG_LEVEL=info
```

## Resolution Priority

When spawning a bot, credentials are resolved in this order:

1. CLI flag (`--auth <profile>`)
2. Environment variables (`ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`)
3. Default auth profile (`mecha auth default`)

## See Also

- [Configuration Guide](/guide/configuration) — auth profiles and bot settings
- [Multi-Machine Setup](/guide/multi-machine) — environment setup across nodes
- [Metering & Budgets](/features/metering) — cost tracking configuration
- [Mesh Networking](/features/mesh-networking) — `MECHA_CLUSTER_KEY` usage
- [Error Reference](/reference/errors) — complete error catalog
