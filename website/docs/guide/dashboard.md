---
title: Dashboard Guide
description: Getting started with the Mecha web dashboard
---

# Dashboard Guide

[[toc]]

The Mecha dashboard is a web-based GUI for managing bots, sessions, schedules, and system settings. This guide covers getting started — for the full feature reference, see the [Dashboard Feature Reference](/features/dashboard).

## Starting the Dashboard

The dashboard starts automatically with `mecha start`:

```bash
mecha start --port 7660
```

Or start it standalone:

```bash
mecha dashboard serve
mecha dashboard serve --port 8080 --open
```

| Option | Default | Description |
|--------|---------|-------------|
| `--port` | 7660 | Dashboard port |
| `--host` | 127.0.0.1 | Bind address |
| `--open` | false | Open browser after starting |

## First-Time Setup

1. **Set up TOTP authentication:**

```bash
mecha totp setup
```

2. **Scan the QR code** with an authenticator app (Google Authenticator, Authy, 1Password, etc.)

3. **Verify your code:**

```bash
mecha totp verify <code>
```

4. **Open the dashboard** at `http://localhost:7660` and enter your TOTP code.

## Common Tasks

### Managing Bots

The home page shows all bots in a grid. Each card displays name, status, port, workspace, and tags.

- **Spawn a bot** via CLI, then manage it from the dashboard
- **Stop/Kill** bots using the action buttons on each card
- **Stop All / Restart All** using the header buttons (with dry-run confirmation)

### Viewing Sessions

Click a bot card to open the detail view. The **Sessions** tab lists all sessions with ID, title, and timestamps.

### Using the Terminal

Click the **Terminal** button on any bot to open a web-based terminal. This connects to the bot's Claude Code session via PTY — full ANSI color, cursor movement, and resize support.

- Select an existing session or start a new one
- Close the tab without killing the session — reopen to reconnect
- Works for remote bots via WebSocket relay

### Monitoring Costs

The home page shows metering summary cards: today's request count, cost, token usage, and average latency. These refresh every 30 seconds.

### Mesh Topology

The **Nodes** page shows all registered peer nodes with live health status, latency, and bot counts. Health data refreshes every 30 seconds.

## Troubleshooting

| Problem | Solution |
|---------|----------|
| TOTP code rejected | Check your system clock — TOTP requires accurate time (within 30s) |
| Dashboard not loading | Ensure the SPA is built: `pnpm --filter @mecha/spa build` |
| "SPA not found" warning | Run `mecha start` instead of `mecha agent start` for the embedded dashboard |
| Login locked out | Wait 60 seconds after 5 failed attempts |

## See Also

- [Dashboard Feature Reference](/features/dashboard) — Complete feature documentation with architecture, API endpoints, security, and polling details
- [Dashboard Components](/reference/components) — React component reference
- [System Commands](/reference/cli/system) — `mecha start`, `mecha dashboard serve` CLI reference
