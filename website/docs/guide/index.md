# What is Mecha?

Mecha is a CLI tool that runs autonomous Claude bots inside Docker containers. Each bot is a long-lived process with its own workspace, schedule, and communication channel.

## Why Mecha?

Claude Code is powerful for interactive coding sessions. But what if you want bots that:

- **Run on a schedule** — review PRs every 30 minutes, check for security updates daily
- **React to events** — process GitHub webhooks, respond to push events
- **Talk to each other** — a reviewer bot asks a security bot to audit a dependency
- **Stay isolated** — each bot has its own Docker container, workspace, and budget

Mecha makes all of this work from a single CLI.

## How It Works

```
Host (CLI)                    Container (Agent)
─────────────────────────     ──────────────────────────
mecha spawn reviewer.yaml     → Docker container starts
mecha query reviewer "..."    → Claude Code SDK session
mecha logs reviewer           → Container stdout/stderr
mecha stop reviewer           → Graceful container stop
```

1. You define a bot in a YAML config file (or inline with flags)
2. `mecha spawn` builds and runs a Docker container
3. Inside the container, an agent process manages Claude Code sessions
4. The bot exposes an HTTP API for chat, scheduling, webhooks, and status
5. The host CLI proxies commands to the container

## Key Concepts

### Bots are Containers

Each bot runs in its own Docker container with:
- A dedicated Claude Code process
- Optional workspace mounting (read-only or writable)
- Its own API key (via auth profiles)
- Budget limits and turn caps

### The Agent

Inside each container, the **agent** (`agent/entry.ts`) runs an HTTP server that:
- Accepts chat prompts via the SDK
- Runs cron schedules
- Processes webhook payloads
- Tracks costs and session history
- Serves the bot dashboard

### Auth Profiles

API keys are managed as named profiles, not environment variables passed to containers:

```bash
mecha auth add anthropic-main sk-ant-...
mecha spawn --name reviewer --system "..." --auth anthropic-main
```

### Fleet Dashboard

A fleet-level dashboard at `localhost:7700` shows all running bots with status, costs, and navigation to individual bot dashboards.
