# Mecha v3 — Architecture

## Overview

Mecha is a CLI that spawns and manages containerized Claude AI agents. Each agent (bot) runs as an isolated Docker container with its own identity, schedule, auth, and persistent state.

```
User → CLI (host) → Docker Container (Agent SDK) → Claude API
                           ↕
                     Responds to events
                     Runs on schedule
                     Talks to other bots
```

## Core Principles

1. **Simple** — one package, ~10 commands, flat file structure
2. **Containerized** — each bot is a Docker container, sandboxing for free
3. **Autonomous** — bots own their schedules, decide their behavior
4. **Persistent** — per-task sessions survive restarts
5. **Responsive** — bots accept prompts, webhooks, and inter-bot calls at any time
6. **Mesh-networked** — Tailscale/Headscale for bot-to-bot across machines

## Two Build Targets, One Repo

```
mecha/
├── src/          → CLI, runs on host, manages Docker
└── agent/        → runs inside the container
```

The CLI is a thin Docker orchestrator. The real logic lives in the container.

## Network Topology

Bots communicate via Tailscale/Headscale mesh. Each container has Tailscale installed and joins a tailnet on boot. This replaces Docker bridge networking for inter-bot traffic and enables multi-machine deployments naturally.

```
┌─ Machine A ──────────────────┐     ┌─ Machine B ──────────────────┐
│                               │     │                               │
│  ┌────────────┐               │     │               ┌────────────┐ │
│  │  reviewer   │               │     │               │  researcher │ │
│  │  tailscale  │◄──── tailnet mesh ────►  tailscale  │ │
│  │  100.x.x.1 │               │     │               │  100.x.x.2 │ │
│  └────────────┘               │     │               └────────────┘ │
│                               │     │                               │
│  ┌────────────┐               │     │                               │
│  │ coordinator │               │     │                               │
│  │  100.x.x.3 │               │     │                               │
│  └────────────┘               │     │                               │
└───────────────────────────────┘     └───────────────────────────────┘
                    ┌──────────────────┐
                    │  Headscale       │
                    │  (coordination)  │
                    └──────────────────┘
```

Bot discovery via MagicDNS (`mecha-reviewer`) or Headscale API. External webhook access via Tailscale Funnel or fallback port mapping. See `networking.md` for details.

## Data Layout

Bot state lives at a user-specified path (fallback: `~/.mecha/bots/<name>/`). See `volumes.md`.

```
~/.mecha/                            # global
├── auth/                            # auth profiles
├── registry.json                    # bot name → path mapping
└── mecha.json                       # global config

<bot-path>/                          # per-bot (user-specified or ~/.mecha/bots/<name>/)
├── config.yaml
├── costs.json
├── sessions/
├── data/
├── logs/
├── tailscale/
└── claude/
```

## Container Internals

Managed by s6-overlay (two long-lived processes: tailscaled + node).

```
Container boot sequence (s6-overlay):
  1. s6-overlay starts as PID 1
  2. Start tailscaled daemon
  3. tailscale up --auth-key=... --hostname=mecha-{name}
  4. Validate environment variables (Zod)
  5. Read /config/bot.yaml
  6. Read /state/sessions/, /state/costs.json
  7. Start HTTP server on :3000
  8. Create MCP tool server via createSdkMcpServer() (mecha_call, mecha_list, mecha_new_session)
  9. Start cron scheduler
  10. Ready

Shutdown (SIGTERM):
  1. Stop scheduler (skip pending runs)
  2. Abort in-flight query (AbortController)
  3. Flush session state
  4. Close HTTP server
  5. tailscale down
  6. Exit
```

### Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/health` | GET | Liveness check |
| `/prompt` | POST | Accept prompt, stream response via SSE |
| `/webhook` | POST | External events (filtered by allowlist) |
| `/api/status` | GET | Real-time bot state (for pixel office) |
| `/api/costs` | GET | Token usage and cost |
| `/api/status/stream` | GET | SSE stream of state changes |
| `/api/tasks` | GET | List tasks/sessions |
| `/api/tasks/:id` | GET | Task conversation history |
| `/api/schedule` | GET | Schedule status + next runs |
| `/api/config` | GET | Bot config (read-only) |
| `/dashboard/*` | GET | Bot SPA static files |

### Internal Tools (injected into Agent SDK)

| Tool | Purpose |
|------|---------|
| `mecha_call` | Call another bot by name, get response |
| `mecha_list` | Discover running bots on the tailnet |
| `mecha_new_session` | Start a fresh conversation task |

### Concurrency

One query at a time per bot. Concurrent `/prompt` requests return `409 Conflict`. Scheduled runs skip if busy.

### Security

- **Non-root user**: Claude runs as `appuser` (UID 10001) inside the container. **Never root.**
- **Permission mode**: `bypassPermissions` — bots are autonomous, the container is the sandbox. No human to answer prompts.
- **Workspace**: Mounted read-only by default. Writable only if explicitly configured.
- **Network**: Tailscale encrypts all traffic. ACLs restrict bot-to-bot access.
- **Volumes**: Bot state dirs owned by `appuser`. No host system access beyond mounted volumes.
