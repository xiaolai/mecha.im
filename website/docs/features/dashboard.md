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

- **Header**: Name, status badge, action buttons (Chat, Stop, Kill)
- **Overview cards**: Port, workspace path, start time
- **Tags**: Displayed as badges
- **Sessions tab**: Table of all sessions (ID, title, created, updated)
- **Config tab**: Raw JSON configuration dump

Data auto-refreshes every **5 seconds**.

### Chat

Send messages to a running CASA via a built-in chat interface. Messages stream back in real time via SSE.

- User messages appear right-aligned (primary color)
- Assistant responses appear left-aligned (muted background)
- Session ID is displayed after the first response
- Session continuity is maintained across messages within the same chat

The chat uses `requestAnimationFrame` throttling to batch stream updates and avoid excessive re-renders.

### Mesh Topology

View all registered peer nodes in a 3-column grid. Each card shows:

- Node name and "managed" badge (if applicable)
- Host and port (monospace)
- Public key fingerprint (truncated, full value on hover)
- Server URL (if configured)
- Date added

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

List all CASAs. Bearer tokens are redacted from the response.

```json
// Response 200
[
  {
    "name": "researcher",
    "state": "running",
    "pid": 12345,
    "port": 7701,
    "workspacePath": "/home/user/papers",
    "startedAt": "2026-02-28T10:00:00Z",
    "tags": ["research", "prod"]
  }
]
```

#### `GET /api/casas/[name]`

Get status for a single CASA. Token redacted.

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

| Status | Condition |
|--------|-----------|
| 200 | Success |
| 400 | Invalid CASA name |
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

### Chat

#### `POST /api/casas/[name]/chat`

Send a message to a running CASA. Response is an SSE stream.

**Request body:**

```json
{
  "message": "Summarize the latest papers",
  "sessionId": "optional-session-id"
}
```

| Field | Type | Required | Constraint |
|-------|------|----------|------------|
| `message` | string | yes | Max 100,000 characters |
| `sessionId` | string | no | Resume an existing session |

**Response:** `text/event-stream`

```
data: {"type":"text","content":"Here are the latest"}

data: {"type":"text","content":" findings from..."}

data: {"type":"done","sessionId":"sess_abc123"}
```

| Event type | Fields | Description |
|------------|--------|-------------|
| `text` | `content: string` | Streamed text chunk |
| `done` | `sessionId: string` | Chat complete |
| `error` | `content: string` | Error occurred |

| Status | Condition |
|--------|-----------|
| 200 | Stream started |
| 400 | Invalid JSON, missing message, message too long, invalid name |
| 503 | Dashboard not initialized |

The stream supports client-side abort via the request signal. If the client disconnects, the server-side iterator is cancelled cleanly.

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

List mesh peer nodes. The `apiKey` field is redacted from the response.

```json
// Response 200
[
  {
    "name": "bob",
    "host": "192.168.1.100",
    "port": 7660,
    "fingerprint": "SHA256:abc...",
    "managed": true,
    "addedAt": "2026-02-28T09:00:00Z"
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

The dashboard uses client-side polling for data freshness. No WebSocket connection is required for basic operation.

| View | Interval | Endpoint |
|------|----------|----------|
| CASA List | 5s | `GET /api/casas` |
| CASA Detail | 5s | `GET /api/casas/[name]` |
| Audit Log | 10s | `GET /api/audit?limit=100` |
| Meter Summary | 30s | `GET /api/meter/cost` |
| Mesh/ACL/Settings | One-shot | Respective endpoints |

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
