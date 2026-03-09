---
title: Quick Start
description: Go from zero to a working bot in 5 minutes.
---

# Quick Start

[[toc]]

Go from zero to a working bot in 5 minutes.

## 1. Install

```bash
brew install xiaolai/tap/mecha
```

Or see [Installation](/guide/installation) for other methods.

## 2. Initialize

Create the `~/.mecha/` directory where all bot state lives:

```bash
mecha init
```

## 3. Set Up Auth

Your bots need credentials to call the Claude API. Pick one:

```bash
# Option A: API key
export ANTHROPIC_API_KEY=sk-ant-api03-...

# Option B: OAuth token (preferred)
export CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-...
```

Or store credentials persistently with the auth command:

```bash
mecha auth add mykey --api-key --token sk-ant-api03-...
mecha auth test mykey
```

## 4. Start the Runtime

```bash
mecha start -d
```

This starts three services in the background:

| Service | Port | What it does |
|---------|------|--------------|
| Agent server | 7660 | Manages bots, serves the dashboard |
| Meter proxy | 7600 | Tracks API costs per bot |
| MCP server | 7680 | Exposes bots as MCP tools |

The `-d` flag runs the server as a background daemon. On first run it displays a TOTP QR code — scan it with your authenticator app. The dashboard is at `http://localhost:7660`.

Check that everything is running:

```bash
mecha status
```

## 5. Spawn a Bot

```bash
mecha bot spawn researcher ~/my-research
```

This creates a bot named `researcher` with `~/my-research` as its workspace. The bot starts immediately — you'll see it allocated a port in the 7700-7799 range.

Check it's running:

```bash
mecha bot ls
```

```text
NAME         STATE    PORT  WORKSPACE
researcher   running  7700  ~/my-research
```

## 6. Chat

```bash
mecha bot chat researcher "What files are in my workspace?"
```

The response streams to your terminal. The bot can read and write files in its workspace, run commands in its sandbox, and use any tools available to Claude Code.

## 7. Spawn More Bots

```bash
mecha bot spawn coder ~/my-project
```

Now you have two bots. Each has its own workspace, sessions, and identity.

## 8. Let Them Talk

Grant the coder permission to query the researcher:

```bash
mecha acl grant coder query researcher
```

Now when the coder needs help, it can reach the researcher through the mesh:

```bash
mecha bot chat coder "Ask the researcher to summarize recent papers on transformers"
```

## 9. Add a Schedule

Make the researcher check for new papers every morning:

```bash
mecha schedule add researcher --cron "0 9 * * *" --prompt "Check for new papers published today and summarize the top 3"
```

The bot will run this task automatically at 9 AM every day. No need to be at your terminal.

## 10. Monitor Costs

```bash
mecha cost
```

```text
Today's API cost: $0.42
  researcher: $0.28
  coder:      $0.14
```

Set a daily budget to prevent surprises:

```bash
mecha budget set --global --daily 10.00
```

Bots that hit the budget are paused automatically.

## 11. Stop

```bash
# Stop a specific bot
mecha bot stop researcher

# Stop everything (bots + daemon)
mecha stop
```

Bot state persists across restarts. Next time you `mecha start -d`, you can respawn bots and their conversation history is still there.

## What's Next?

- [Core Concepts](/guide/concepts) — bots, workspaces, sessions, naming
- [Configuration](/guide/configuration) — customize bot behavior, models, system prompts
- [Scheduling](/features/scheduling) — cron jobs, webhooks, event-driven bots
- [Permissions](/features/permissions) — fine-grained access control between bots
- [Multi-Machine](/guide/multi-machine) — deploy bots across multiple machines
- [CLI Reference](/reference/cli/) — complete command documentation
