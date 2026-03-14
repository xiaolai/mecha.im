# Architecture

## Overview

```
Host (CLI)                    Container (Agent)
─────────────────────────     ──────────────────────────
src/cli.ts                    agent/entry.ts
src/docker.ts (dockerode)     agent/server.ts (Hono)
src/store.ts (~/.mecha/)      agent/session.ts
src/config.ts                 agent/scheduler.ts (croner)
src/auth.ts                   agent/webhook.ts
src/dashboard-server.ts       agent/costs.ts
                              agent/activity.ts
                              agent/tools/mecha-server.ts
                              agent/tools/mecha-call.ts
                              agent/tools/mecha-list.ts
```

## Host Side

The **CLI** (`src/cli.ts`) uses Commander to provide all `mecha` commands. It talks to Docker via **dockerode** (`src/docker.ts`) to manage container lifecycle.

**Store** (`src/store.ts`) manages persistent state in `~/.mecha/` — bot metadata, auth profiles, and image build artifacts.

**Config** (`src/config.ts`) loads and validates YAML bot config files using Zod schemas.

**Dashboard Server** (`src/dashboard-server.ts`) serves the fleet dashboard SPA and proxies requests to individual bot containers.

## Container Side

Each container runs an **agent** process managed by s6-overlay.

**Entry** (`agent/entry.ts`) bootstraps the agent, reads config from environment, and starts the HTTP server.

**Server** (`agent/server.ts`) is a Hono HTTP server exposing routes for:
- `/api/chat` — SDK-based chat
- `/api/config` — bot configuration
- `/api/schedule` — cron management
- `/api/webhooks` — webhook processing
- `/api/sessions` — session history
- `/dashboard` — bot dashboard SPA

**Session** (`agent/session.ts`) manages Claude Code SDK sessions — starting conversations, tracking turns, and recording history.

**Scheduler** (`agent/scheduler.ts`) uses croner for cron scheduling with safety guards (daily limits, timeouts, error-pause).

## Communication

### CLI → Container

The host CLI communicates with bot containers via HTTP. Each container exposes an internal API server. The fleet dashboard proxies requests to the correct container.

### Bot → Bot

Bots communicate over Tailscale using MCP tools:
- `mecha_call` — send a prompt to another bot
- `mecha_list` — discover available bots
- `mecha_new_session` — start fresh conversation

### Docker

The container image is Alpine-based with:
- Node.js 22 (installed as appuser)
- Claude Code CLI
- s6-overlay for process supervision
- Optional Tailscale daemon
