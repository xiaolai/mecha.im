# Architecture

## Overview

```
Host (Daemon)                 Container (Agent)
─────────────────────────     ──────────────────────────
src/daemon.ts (singleton)     agent/entry.ts
src/dashboard-server.ts       agent/server.ts (Hono)
src/docker.ts (dockerode)     agent/session.ts
src/store.ts (~/.mecha/)      agent/scheduler.ts (croner)
src/config.ts                 agent/webhook.ts
src/auth.ts                   agent/costs.ts
src/daemon-audit.ts           agent/activity.ts
                              agent/tools/mecha-server.ts
                              agent/tools/mecha-call.ts
                              agent/tools/mecha-list.ts
                              agent/tools/mecha-fleet.ts
```

## Daemon

The mecha **daemon** (`src/daemon.ts`) is a singleton process that runs the fleet control plane:

- **HTTP API**: Fleet dashboard + fleet management API (Hono)
- **Reconciler**: 30-second loop comparing desired state to actual Docker state, auto-restarting crashed bots
- **Audit log**: Structured JSONL logging of all fleet operations
- **Singleton lock**: Directory-based lock at `~/.mecha/.daemon.lock` with mtime refresh

The daemon auto-starts when you run any fleet command (`spawn`, `ls`, `stop`, etc.). You can also start it explicitly:

```bash
mecha daemon start --background
```

### Fleet API

Two API namespaces:

| Path | Auth | Purpose |
|------|------|---------|
| `/api/*` | Dashboard session/token | Human users via browser/CLI |
| `/api/fleet/*` | `MECHA_FLEET_INTERNAL_SECRET` | Orchestrator bots (machine-to-machine) |

### Reconciliation

The daemon maintains `desired_state` for each bot in the registry:

| desired_state | Behavior |
|---------------|----------|
| `running` | Auto-restart if container exits |
| `stopped` | Auto-stop if container drifts to running |
| `removed` | Entry deleted from registry |

## Host Side

The **CLI** (`src/cli.ts`) uses Commander to provide all `mecha` commands. It auto-starts the daemon when needed.

**Store** (`src/store.ts`) manages persistent state in `~/.mecha/` — bot metadata, auth profiles, and fleet secrets.

**Config** (`src/config.ts`) loads and validates YAML bot config files using Zod schemas.

## Container Side

Each container runs an **agent** process managed by s6-overlay.

**Server** (`agent/server.ts`) is a Hono HTTP server exposing routes for:
- `/prompt` — SDK-based chat
- `/api/config` — bot configuration
- `/api/schedule` — cron management
- `/api/webhooks` — webhook processing
- `/api/sessions` — session history
- `/dashboard` — bot dashboard SPA

**Session** (`agent/session.ts`) manages Claude Code SDK sessions — starting conversations, tracking turns, and recording history.

**Scheduler** (`agent/scheduler.ts`) uses croner for cron scheduling with safety guards (daily limits, timeouts, error-pause).

## Communication

### CLI → Daemon → Container

The CLI talks to the daemon, which proxies requests to bot containers. Some commands (`query`, `exec`, `logs`) talk directly to Docker or bot containers.

### Bot → Bot

Bots communicate over Tailscale using MCP tools:
- `mecha_call` — send a prompt to another bot
- `mecha_list` — discover available bots
- `mecha_new_session` — start fresh conversation

### Orchestrator → Daemon

Bots with `fleet_control: true` get fleet MCP tools that call the daemon's `/api/fleet/*` endpoints:
- `mecha_fleet_ls`, `mecha_fleet_spawn`, `mecha_fleet_stop`, etc.
- Authenticated with `MECHA_FLEET_INTERNAL_SECRET`
- Regular bots do NOT have access to these tools or the fleet API

### Docker

The container image is Alpine-based with:
- Node.js 22 (installed as appuser)
- Claude Code CLI + Agent SDK (JS + Python)
- Codex CLI + Gemini CLI
- s6-overlay for process supervision
- Optional Tailscale daemon
