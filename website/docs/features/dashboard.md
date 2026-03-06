---
title: Dashboard
description: Web-based GUI for managing bots, sessions, logs, and runtime settings.
---

# Dashboard

[[toc]]

The web dashboard provides a graphical interface for managing your mecha runtime. It runs as a pre-built SPA served by the agent server — no separate daemon or API server needed.

## Quick Start

```bash
mecha dashboard serve
```

Opens the dashboard at `http://localhost:7660`.

```bash
# Custom port
mecha dashboard serve --port 8080

# Auto-open browser
mecha dashboard serve --open
```

| Option | Default | Description |
|--------|---------|-------------|
| `--port` | 7660 | Dashboard port |
| `--host` | 127.0.0.1 | Bind address |
| `--open` | false | Open browser after starting |

## Architecture

The dashboard is a single-page application (SPA) served by the Mecha agent server (`@mecha/agent`). The agent server is a Fastify-based HTTP + WebSocket server that hosts the dashboard UI alongside all API routes in a single process on a single port.

```
mecha start
  └── Agent Server (port 7660)
       ├── /healthz           → Health check (public)
       ├── /auth/*            → TOTP login/logout/status
       ├── /bots             → bot lifecycle
       ├── /events            → SSE real-time events
       ├── /acl               → ACL rules
       ├── /audit             → Audit log
       ├── /mesh/nodes        → Mesh topology
       ├── /meter/cost        → Metering data
       ├── /settings/runtime  → Runtime config
       ├── /discover          → bot discovery
       ├── /ws/ticket         → WebSocket ticket issuance
       ├── /ws/terminal/:name → WebSocket terminal (PTY)
       └── /*                 → SPA static files + client-side routing
  └── ProcessManager (in-process)
  └── AclEngine (in-process)
```

The agent server is created via `createAgentServer()` from `@mecha/agent`. When `spaDir` is configured, it serves the SPA static files and handles client-side routing fallback. See the [Architecture Reference](/reference/api/#createagentserveropts) for the full API specification.

## Pages

### bot List (Home)

The home page shows all bots in a responsive 3-column grid. Each card displays:

- Name and status badge (running/stopped/error)
- Port number (monospace)
- Workspace path (truncated)
- Tags
- Stop and Kill buttons (running bots only)
- **Stop All** and **Restart All** buttons in the header (when bots exist)

The batch buttons open a confirmation dialog that:
1. Runs a dry-run pre-flight to show which bots will be affected
2. Highlights busy bots (with active session count)
3. Offers "Force" option for busy bots, or "Idle Only" to skip them
4. Shows per-bot progress and a summary on completion
5. Allows retrying only failed bots

Cards auto-refresh every **5 seconds** via polling. Click a card to open the detail view.

The home page also shows a **metering summary** — four cards showing today's request count, cost, token usage, and average latency. This section auto-refreshes every **30 seconds**.

### bot Detail

The detail view shows full information for a single bot:

- **Header**: Name, status badge, action buttons (Terminal, Stop, Kill)
- **Overview cards**: Port, workspace path, start time
- **Tags**: Displayed as badges
- **Sessions tab**: Table of all sessions (ID, title, created, updated)
- **Config tab**: Raw JSON configuration dump

Data auto-refreshes every **5 seconds**.

### Terminal

Attach to any bot session in a real terminal emulator powered by xterm.js. The terminal connects to `claude --resume <session>` via a WebSocket-to-PTY bridge, providing the full Claude Code experience in the browser.

- **Session selector**: Dropdown of existing sessions or "New Session" button
- **Full PTY**: ANSI colors, cursor movement, progress bars — everything works
- **Resize**: Terminal resizes with browser window via `@xterm/addon-fit`
- **Scrollback**: 10,000-line scrollback buffer
- **Theme**: Matches dashboard dark/light mode
- **Detach/Reattach**: Close the tab without killing the session. Reopen to reconnect.
- **Multi-tab**: Multiple browser tabs can attach to the same PTY session
- **Remote bots**: Terminal works for bots on remote nodes via WebSocket relay through the agent server

The WebSocket endpoint is `ws://host:port/ws/terminal/<bot-name>?session=<id>&node=<node>`. Session auth is validated during the HTTP upgrade handshake.

### Mesh Topology

View all registered peer nodes in a 3-column grid with live health status. Each card shows:

- Status dot (green for online, red for offline)
- Node name and status badge
- Latency in ms (online nodes)
- bot count (online nodes)
- Error message (offline nodes)

Health data auto-refreshes every **30 seconds** via the `fetchAllNodes` mesh proxy.

### Mesh-Wide Management

The dashboard manages bots across all mesh nodes from a single interface:

- **Unified bot list**: The home page shows local and remote bots together. Remote bots display a `@ node-name` badge.
- **Node dispatch**: All bot API routes accept `?node=X` to proxy requests to remote nodes. Local operations use the in-process ProcessManager.
- **Remote actions**: Stop, Kill, and session listing work on remote bots through the agent server proxy.
- **Detail view**: The bot detail page shows a node badge and routes actions through `?node=X` for remote bots. Terminal works for both local and remote bots via WebSocket relay.

### ACL Rules

Browse all access control rules in a table:

| Column | Description |
|--------|-------------|
| Source | Principal identifier (bot name) |
| Target | Resource identifier (bot name) |
| Capabilities | Granted capabilities displayed as badges |

### Audit Log

View the last 100 audit entries. Auto-refreshes every **10 seconds**.

| Column | Description |
|--------|-------------|
| Time | ISO-8601 timestamp |
| Tool | Tool/command name |
| Client | Client identifier |
| Result | Status badge: ok (green), error (red), rate-limited (yellow) |
| Duration | Execution time in ms |

### Settings

Two sections:

- **Node Configuration**: Count of registered peers with a name-to-host:port listing
- **Runtime**: bot port range, agent port, and MCP port (fetched from the runtime API, not hardcoded)

### Dark Mode

Toggle between light and dark themes using the button in the top bar. The dashboard respects your system preference by default via `next-themes`.

## Real-time Events

The dashboard subscribes to runtime events via SSE at `/events`. Events include bot state changes (spawn, stop, exit, error).

| Parameter | Value |
|-----------|-------|
| Max connections | 10 concurrent |
| Heartbeat | Every 10 seconds |
| Reconnect | Automatic on disconnect |
| Overflow | 429 Too Many Requests |

## API Reference

The dashboard SPA communicates with the agent server's HTTP API. All endpoints are served directly (no `/api/` prefix) and protected by TOTP session authentication.

For the complete API specification including request/response formats, see the [Agent Server API](/reference/api/#createagentserveropts) in the Architecture Reference.

### Key Endpoints Used by the Dashboard

| Endpoint | Dashboard Feature |
|----------|-------------------|
| `GET /bots` | Home page bot list |
| `GET /bots/:name/status` | bot detail view |
| `POST /bots/:name/start` | Start button |
| `POST /bots/:name/stop` | Stop button (with busy check) |
| `POST /bots/:name/kill` | Kill button |
| `POST /bots/batch` | Stop All / Restart All dialog |
| `PATCH /bots/:name/config` | Config editor |
| `GET /bots/:name/sessions` | Sessions tab |
| `DELETE /bots/:name/sessions/:id` | Session delete |
| `GET /events` | Real-time SSE updates |
| `GET /acl` | ACL rules page |
| `GET /audit` | Audit log page |
| `GET /mesh/nodes` | Mesh topology page |
| `GET /meter/cost` | Metering summary cards |
| `GET /settings/runtime` | Settings page |
| `GET /discover` | bot discovery |
| `POST /ws/ticket` | Terminal ticket issuance |
| `WS /ws/terminal/:name` | Terminal emulator |
| `GET /auth/status` | Login page (check auth methods) |
| `POST /auth/login` | TOTP login |
| `POST /auth/logout` | Logout |
| `GET /auth/profiles` | Auth profile dropdown |

## Security

The dashboard is protected by the agent server's authentication system.

### TOTP Authentication

Dashboard access requires a valid TOTP code. On first visit, the SPA prompts for a 6-digit TOTP code. On successful verification, a session cookie (`mecha-session`) is set.

- **Session cookie**: `HttpOnly`, `SameSite=Strict`, `Secure` (when not on localhost)
- **Session TTL**: 24 hours by default (configurable via `sessionTtlHours`)
- **Rate limiting**: 5 failed login attempts within 30 seconds triggers a 60-second lockout

### WebSocket Authentication

WebSocket connections (terminal) use single-use tickets because browser WebSocket APIs cannot set custom headers:

1. SPA calls `POST /ws/ticket` (authenticated via session cookie)
2. Server returns a 30-second single-use ticket
3. SPA connects to `ws://host/ws/terminal/:name?ticket=<ticket>`

### Mesh Authentication

Inter-node routing requests use Bearer token auth plus Ed25519 signatures. See the [Architecture Reference](/reference/api/#route-summary) for details.

### Error Sanitization

Internal error messages and stack traces are never exposed to clients. API error responses return generic messages:

```json
{ "error": "Internal server error" }
```

The full error details are logged server-side. Fastify's logger redacts `authorization` and `x-mecha-signature` headers from request logs.

## Polling Intervals

The dashboard uses client-side polling for data freshness. WebSocket connections are used only for the terminal feature.

| View | Interval | Endpoint |
|------|----------|----------|
| bot List | 5s | `GET /bots` |
| bot Detail | 5s | `GET /bots/[name]` |
| Audit Log | 10s | `GET /audit?limit=100` |
| Meter Summary | 30s | `GET /meter/cost` |
| Mesh Nodes | 30s | `GET /mesh/nodes` |
| ACL/Settings | One-shot | Respective endpoints |

All polling uses `AbortController` to cancel in-flight requests when a new poll starts or the component unmounts — preventing race conditions and stale data.

## Responsive Design

The dashboard is mobile-first:

- **Sidebar**: Collapsible drawer on mobile, fixed on desktop (`md:` breakpoint)
- **bot grid**: Single column on mobile, 3 columns on desktop
- **Touch targets**: All interactive elements meet 44px minimum tap size on mobile
- **Buttons**: Full-width on mobile, auto-width on desktop
- **Action buttons**: Use tooltip icon buttons with `aria-label` for accessibility

## Structured Logging

All API routes log events as structured JSON to stdout/stderr:

```json
{
  "ts": "2026-02-28T10:00:00.000Z",
  "level": "info",
  "ns": "dashboard",
  "route": "GET /bots",
  "msg": "Listed 3 bots"
}
```

Log levels:

| Level | Output | Use |
|-------|--------|-----|
| `info` | stdout | Normal operations |
| `warn` | stdout | Degraded but recoverable |
| `error` | stderr | Failures requiring attention |
