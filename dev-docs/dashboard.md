# Dashboard

## Two Levels

There are two distinct dashboards:

1. **Fleet Dashboard** — manages all bots, runs on host
2. **Bot Dashboard** — individual bot UI, runs inside each container

Both are accessed through a single URL. The fleet dashboard proxies into each bot's self-served UI.

## Access

```
mecha dashboard                   # starts host server, opens browser
```

```
localhost:7700/                    → fleet dashboard (host)
localhost:7700/bot/reviewer/       → reviewer's dashboard (proxied from container)
localhost:7700/bot/researcher/     → researcher's dashboard (proxied from container)
```

One URL. User never needs to know container ports.

## Architecture

```
┌───────────────────────────────────────────────────┐
│ HOST DASHBOARD (fleet)            localhost:7700    │
│                                                     │
│  Fleet overview, network map, auth management       │
│                                                     │
│  ┌───────────────────────────────────────────────┐ │
│  │ BOT DASHBOARD (proxied)     /bot/reviewer/     │ │
│  │                                                │ │
│  │  Chat, Tasks, Schedule, Logs                   │ │
│  │  Served by the container itself                │ │
│  └───────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────┘
```

The bot owns its UI. When you swap or upgrade a bot image, its dashboard updates automatically.

## Fleet Dashboard (host)

### Views

**Fleet Overview (home)**

```
┌─────────────────────────────────────────────────┐
│  MECHA                            3 bots running │
│                                                   │
│  ● reviewer     sonnet   2h 15m   2 schedules    │
│  ● researcher   sonnet   45m      —               │
│  ○ coordinator  opus     stopped  1 schedule      │
│                                                   │
│  [Spawn Bot]                                      │
└─────────────────────────────────────────────────┘
```

- Bot status (running / stopped / error)
- Model, uptime, schedule count
- Quick actions: stop, restart, remove
- Spawn new bot (paste YAML or fill form)

**Network Map**

```
┌──────────────────────────────────────┐
│                                       │
│   coordinator ──→ reviewer            │
│        │                              │
│        └────────→ researcher          │
│                                       │
│   webhook:8080 ──→ reviewer           │
│                                       │
└──────────────────────────────────────┘
```

Built from actual `mecha_call` usage in logs. Shows real communication graph.

**Auth Management**

```
Profiles:
  anthropic-main    ██████████  used by: reviewer, researcher
  anthropic-backup  ██████████  used by: —
  github-bot        ██████████  used by: coordinator

[Add Profile]    [Swap]
```

### Fleet API (host server)

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/bots` | GET | List all bots (from Docker) |
| `/api/bots` | POST | Spawn a new bot |
| `/api/bots/:name` | DELETE | Stop + remove bot |
| `/api/bots/:name/restart` | POST | Restart bot |
| `/api/auth` | GET | List auth profiles |
| `/api/auth` | POST | Add auth profile |
| `/api/auth/:bot/swap` | POST | Swap bot auth |
| `/api/network` | GET | Communication graph |
| `/bot/:name/*` | * | **Proxy to container dashboard** |
| `/*` | GET | Serve fleet SPA |

## Bot Dashboard (container)

Each container serves its own UI and API. The fleet dashboard proxies to it.

### Views

**Chat** — send prompts, stream responses (SSE from `/prompt`)

**Tasks** — list of sessions/tasks, click to view conversation history

**Schedule** — cron jobs, next run time, last run result

**Logs** — container stdout/stderr, live tail

**Config** — bot config (read-only view)

### Bot API (container)

| Route | Method | Purpose |
|-------|--------|---------|
| `/health` | GET | Liveness check |
| `/prompt` | POST | Accept prompt, SSE response |
| `/webhook` | POST | External events (filtered) |
| `/api/status` | GET | Real-time bot state |
| `/api/costs` | GET | Token usage and cost |
| `/api/status/stream` | GET | SSE stream of state changes |
| `/api/tasks` | GET | List tasks/sessions |
| `/api/tasks/:id` | GET | Task conversation history |
| `/api/schedule` | GET | Schedule status + next runs |
| `/api/config` | GET | Bot config (read-only) |
| `/dashboard/*` | GET | Bot SPA static files |

## What NOT to build

| Skip | Why |
|------|-----|
| User auth / login | Local tool, single user |
| Metrics / charts | Premature — add when usage data exists |
| Bot config editor | YAML file, edit in your editor |
| Budget / billing | Not in scope |

## Implementation

### Host side

```
src/
└── dashboard.ts           # Hono server: fleet API + proxy + static files
dashboard/
├── src/
│   ├── app.tsx
│   ├── views/
│   │   ├── fleet.tsx      # bot list, spawn form
│   │   ├── network.tsx    # communication map
│   │   └── auth.tsx       # profile management
│   └── api.ts             # fetch wrapper
└── vite.config.ts
```

### Container side

```
agent/
├── server.ts              # add /dashboard/*, /api/tasks, /api/schedule, /api/config
└── dashboard/
    ├── src/
    │   ├── app.tsx
    │   ├── views/
    │   │   ├── chat.tsx
    │   │   ├── tasks.tsx
    │   │   ├── schedule.tsx
    │   │   ├── logs.tsx
    │   │   └── config.tsx
    │   └── api.ts
    └── vite.config.ts
```

### Tech

- Frontend: React + Tailwind
- Build: Vite, output embedded in each build target
- Fleet SPA embedded in CLI package
- Bot SPA embedded in Docker image

### Proxy

The host dashboard proxies bot routes:

```
GET /bot/reviewer/dashboard/chat
  → http://reviewer:3000/dashboard/chat

POST /bot/reviewer/prompt
  → http://reviewer:3000/prompt (SSE passthrough)

GET /bot/reviewer/api/tasks
  → http://reviewer:3000/api/tasks
```

Host resolves bot name → Tailscale IP via Headscale API or MagicDNS.
