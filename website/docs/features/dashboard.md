# Dashboard

The web dashboard provides a graphical interface for managing your mecha runtime. It runs as an in-process Next.js application — no separate daemon or API server needed.

## Quick Start

```bash
mecha dashboard serve
```

Opens the dashboard at [http://localhost:3457](http://localhost:3457).

```bash
# Custom port
mecha dashboard serve --port 8080

# Auto-open browser
mecha dashboard serve --open
```

| Option | Default | Description |
|--------|---------|-------------|
| `--port` | 3457 | Dashboard port |
| `--host` | 127.0.0.1 | Bind address |
| `--open` | false | Open browser after starting |

## Architecture

The CLI starts a Next.js production server and creates a `ProcessManager` in the same process. All API routes access the runtime directly — no HTTP round-trips to a separate backend.

```
mecha dashboard serve
  └── ProcessManager (in-process)
  └── AclEngine (in-process)
  └── Next.js (port 3457)
       ├── /api/casas         → CASA lifecycle
       ├── /api/events        → SSE real-time events
       ├── /api/acl           → ACL rules
       ├── /api/audit         → Audit log
       ├── /api/mesh/nodes    → Mesh topology
       ├── /api/meter/cost    → Metering data
       ├── /api/settings/runtime → Runtime config
       ├── /ws/terminal/:name → WebSocket terminal (PTY)
       └── /                  → Dashboard UI
```

The server handles fatal socket errors (EMFILE, EADDRINUSE, EACCES) with graceful shutdown — it closes the HTTP server and Next.js app cleanly rather than crashing.

## Pages

### CASA List (Home)

The home page shows all CASAs in a responsive 3-column grid. Each card displays:

- Name and status badge (running/stopped/error)
- Port number (monospace)
- Workspace path (truncated)
- Tags
- Stop and Kill buttons (running CASAs only)

Cards auto-refresh every **5 seconds** via polling. Click a card to open the detail view.

The home page also shows a **metering summary** — four cards showing today's request count, cost, token usage, and average latency. This section auto-refreshes every **30 seconds**.

### CASA Detail

The detail view shows full information for a single CASA:

- **Header**: Name, status badge, action buttons (Terminal, Stop, Kill)
- **Overview cards**: Port, workspace path, start time
- **Tags**: Displayed as badges
- **Sessions tab**: Table of all sessions (ID, title, created, updated)
- **Config tab**: Raw JSON configuration dump

Data auto-refreshes every **5 seconds**.

### Terminal

Attach to any CASA session in a real terminal emulator powered by xterm.js. The terminal connects to `claude --resume <session>` via a WebSocket-to-PTY bridge, providing the full Claude Code experience in the browser.

- **Session selector**: Dropdown of existing sessions or "New Session" button
- **Full PTY**: ANSI colors, cursor movement, progress bars — everything works
- **Resize**: Terminal resizes with browser window via `@xterm/addon-fit`
- **Scrollback**: 10,000-line scrollback buffer
- **Theme**: Matches dashboard dark/light mode
- **Detach/Reattach**: Close the tab without killing the session. Reopen to reconnect.
- **Multi-tab**: Multiple browser tabs can attach to the same PTY session
- **Remote CASAs**: Terminal works for CASAs on remote nodes via WebSocket relay through the agent server

The WebSocket endpoint is `ws://host:port/ws/terminal/<casa-name>?session=<id>&node=<node>`. Session auth is validated during the HTTP upgrade handshake.

### Mesh Topology

View all registered peer nodes in a 3-column grid with live health status. Each card shows:

- Status dot (green for online, red for offline)
- Node name and status badge
- Latency in ms (online nodes)
- CASA count (online nodes)
- Error message (offline nodes)

Health data auto-refreshes every **30 seconds** via the `fetchAllNodes` mesh proxy.

### Mesh-Wide Management

The dashboard manages CASAs across all mesh nodes from a single interface:

- **Unified CASA list**: The home page shows local and remote CASAs together. Remote CASAs display a `@ node-name` badge.
- **Node dispatch**: All CASA API routes accept `?node=X` to proxy requests to remote nodes. Local operations use the in-process ProcessManager.
- **Remote actions**: Stop, Kill, and session listing work on remote CASAs through the agent server proxy.
- **Detail view**: The CASA detail page shows a node badge and routes actions through `?node=X` for remote CASAs. Terminal works for both local and remote CASAs via WebSocket relay.

### ACL Rules

Browse all access control rules in a table:

| Column | Description |
|--------|-------------|
| Source | Principal identifier (CASA name) |
| Target | Resource identifier (CASA name) |
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
- **Runtime**: CASA port range, agent port, and MCP port (fetched from the runtime API, not hardcoded)

### Dark Mode

Toggle between light and dark themes using the button in the top bar. The dashboard respects your system preference by default via `next-themes`.

## Real-time Events

The dashboard subscribes to runtime events via SSE at `/api/events`. Events include CASA state changes (spawn, stop, exit, error).

| Parameter | Value |
|-----------|-------|
| Max connections | 10 concurrent |
| Heartbeat | Every 15 seconds |
| Reconnect | Automatic on disconnect |
| Overflow | 429 Too Many Requests |

## API Reference

All endpoints are served under `/api/` and protected by the security middleware.

### CASA Management

#### `GET /api/casas`

List all CASAs (local + remote). Bearer tokens are redacted from the response.

```json
// Response 200
{
  "casas": [
    {
      "name": "researcher",
      "node": "local",
      "state": "running",
      "pid": 12345,
      "port": 7701,
      "workspacePath": "/home/user/papers",
      "startedAt": "2026-02-28T10:00:00Z",
      "tags": ["research", "prod"]
    },
    {
      "name": "analyst",
      "node": "bob",
      "state": "running",
      "port": 7702
    }
  ],
  "nodeStatus": {
    "local": { "name": "local", "status": "online" },
    "bob": { "name": "bob", "status": "online", "latencyMs": 23 }
  }
}
```

#### `GET /api/casas/[name]`

Get status for a single CASA. Token redacted. Supports `?node=X` for remote dispatch.

```json
// Response 200
{
  "name": "researcher",
  "state": "running",
  "pid": 12345,
  "port": 7701,
  "workspacePath": "/home/user/papers",
  "startedAt": "2026-02-28T10:00:00Z",
  "tags": ["research"]
}
```

| Query param | Description |
|-------------|-------------|
| `node` | Node name for remote dispatch (omit or "local" for local) |

| Status | Condition |
|--------|-----------|
| 200 | Success |
| 400 | Invalid CASA name or node name |
| 404 | Node not found |
| 502 | Remote node unreachable |
| 500 | Internal error |

#### `DELETE /api/casas/[name]`

Force kill a CASA (sends SIGKILL).

```json
// Response 200
{ "ok": true }
```

#### `POST /api/casas/[name]/stop`

Graceful stop (sends SIGTERM, escalates to SIGKILL after timeout).

```json
// Response 200
{ "ok": true }
```

#### `POST /api/casas/[name]/kill`

Force kill (sends SIGKILL immediately).

```json
// Response 200
{ "ok": true }
```

### Terminal WebSocket

#### `WS /ws/terminal/<name>?session=<id>&node=<node>`

Attach to a CASA session via WebSocket. The server spawns (or reattaches to) a `claude --resume <session>` PTY process.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `name` | yes | CASA name |
| `session` | no | Session ID to resume (omit for new session) |
| `node` | no | Node name for remote CASAs (omit or "local" for local) |

**Protocol:**

| Direction | Frame Type | Payload | Description |
|-----------|-----------|---------|-------------|
| Client to Server | Binary | Raw keystrokes | Terminal input |
| Client to Server | Text (JSON) | `{ "type": "resize", "cols": N, "rows": N }` | Terminal resize |
| Server to Client | Binary | PTY output bytes | Terminal output (ANSI preserved) |
| Server to Client | Text (JSON) | `{ "type": "session", "id": "..." }` | Session ID assigned |
| Server to Client | Text (JSON) | `{ "type": "error", "message": "..." }` | Error notification |
| Server to Client | Text (JSON) | `{ "type": "exit", "code": N }` | PTY process exited |

**Auth:** Session cookie is validated during the HTTP upgrade handshake. Unauthenticated upgrades are rejected with 401.

**Backpressure:** If the client falls behind (`bufferedAmount > 1MB`), output frames are dropped until the client catches up.

**Close semantics:**
- Client closes WebSocket: PTY stays alive (detached). Client can reconnect.
- PTY exits: Server sends `{ "type": "exit" }` and closes WebSocket.
- Server shutdown: All PTYs receive SIGHUP.

### Sessions

#### `GET /api/casas/[name]/sessions`

List all sessions for a CASA.

```json
// Response 200
[
  {
    "id": "sess_abc123",
    "title": "Paper review",
    "starred": false,
    "createdAt": "2026-02-28T10:00:00Z",
    "updatedAt": "2026-02-28T10:05:00Z"
  }
]
```

#### `GET /api/casas/[name]/sessions/[id]`

Get details for a specific session.

### Events

#### `GET /api/events`

Server-Sent Events stream for real-time runtime events (CASA state changes, etc.).

```
: heartbeat

data: {"type":"spawn","name":"researcher","port":7701}

: heartbeat
```

| Status | Condition |
|--------|-----------|
| 200 | Stream started |
| 429 | Max 10 connections exceeded |
| 503 | Dashboard not initialized |

### ACL

#### `GET /api/acl`

List all ACL rules.

```json
// Response 200
[
  {
    "source": "researcher",
    "target": "coder",
    "capabilities": ["read", "chat"]
  }
]
```

### Audit

#### `GET /api/audit`

Read the audit log.

| Query param | Default | Range | Description |
|-------------|---------|-------|-------------|
| `limit` | 50 | 1–1000 | Number of entries |

```json
// Response 200
[
  {
    "ts": "2026-02-28T10:00:00Z",
    "client": "researcher",
    "tool": "file_read",
    "params": { "path": "/home/user/paper.md" },
    "result": "ok",
    "durationMs": 12
  }
]
```

### Mesh

#### `GET /api/mesh/nodes`

List mesh peer nodes with live health status.

```json
// Response 200
[
  {
    "name": "bob",
    "status": "online",
    "latencyMs": 23,
    "casaCount": 2
  },
  {
    "name": "charlie",
    "status": "offline",
    "error": "unreachable"
  }
]
```

### Metering

#### `GET /api/meter/cost`

Query today's metering data. Optionally filter by CASA name.

| Query param | Description |
|-------------|-------------|
| `casa` | Optional CASA name for per-CASA breakdown |

```json
// Response 200 (no filter)
{
  "period": "today",
  "total": {
    "requests": 42,
    "errors": 1,
    "inputTokens": 150000,
    "outputTokens": 85000,
    "costUsd": 1.23,
    "avgLatencyMs": 450
  },
  "byCasa": {
    "researcher": { "requests": 30, "..." : "..." },
    "coder": { "requests": 12, "..." : "..." }
  }
}
```

### Settings

#### `GET /api/settings/runtime`

Runtime port configuration, sourced from `@mecha/core` defaults.

```json
// Response 200
{
  "casaPortRange": "7700-7799",
  "agentPort": 7660,
  "mcpPort": 7680
}
```

## Security

The dashboard enforces four layers of security:

### DNS Rebinding Protection

Middleware checks the `Host` header on every `/api/*` request. Only localhost addresses are allowed:

- `localhost`
- `127.0.0.1`
- `::1` / `[::1]`

Requests from any other host receive `403 Forbidden`. This prevents DNS rebinding attacks where an external domain resolves to `127.0.0.1` to exploit the local API.

### CSRF Protection

State-changing requests (`POST`, `DELETE`, `PUT`, `PATCH`) must include an `Origin` header matching a localhost address. Requests with a non-localhost `Origin` are rejected with `403 Forbidden`.

Safe methods (`GET`, `HEAD`, `OPTIONS`) skip the origin check.

### Secret Redaction

Sensitive fields are stripped from API responses before they reach the client:

- `token` — Bearer tokens for CASA authentication (all `/api/casas` endpoints)
- `apiKey` — Node API keys (all `/api/mesh/nodes` endpoints)

### Error Sanitization

Internal error messages and stack traces are never exposed to clients. API error responses return generic messages:

```json
{ "error": "Internal server error" }
```

The full error details are logged server-side via structured JSON logging (timestamp, level, route, message, error details).

## Polling Intervals

The dashboard uses client-side polling for data freshness. WebSocket connections are used only for the terminal feature.

| View | Interval | Endpoint |
|------|----------|----------|
| CASA List | 5s | `GET /api/casas` |
| CASA Detail | 5s | `GET /api/casas/[name]` |
| Audit Log | 10s | `GET /api/audit?limit=100` |
| Meter Summary | 30s | `GET /api/meter/cost` |
| Mesh Nodes | 30s | `GET /api/mesh/nodes` |
| ACL/Settings | One-shot | Respective endpoints |

All polling uses `AbortController` to cancel in-flight requests when a new poll starts or the component unmounts — preventing race conditions and stale data.

## Responsive Design

The dashboard is mobile-first:

- **Sidebar**: Collapsible drawer on mobile, fixed on desktop (`md:` breakpoint)
- **CASA grid**: Single column on mobile, 3 columns on desktop
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
  "route": "GET /api/casas",
  "msg": "Listed 3 CASAs"
}
```

Log levels:

| Level | Output | Use |
|-------|--------|-----|
| `info` | stdout | Normal operations |
| `warn` | stdout | Degraded but recoverable |
| `error` | stderr | Failures requiring attention |
