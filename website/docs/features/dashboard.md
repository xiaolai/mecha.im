# Dashboard

The web dashboard provides a graphical interface for managing your mecha runtime.

## Quick Start

```bash
mecha dashboard serve
```

Opens the dashboard at [http://localhost:3457](http://localhost:3457).

## Architecture

The dashboard runs as a Next.js application started by the CLI. It creates a `ProcessManager` in the same process — no separate daemon or API server is needed. This matches the local-first design principle.

```
mecha dashboard serve
  └── ProcessManager (in-process)
  └── Next.js (port 3457)
       ├── /api/casas → CASA list & management
       ├── /api/events → SSE real-time events
       ├── /api/acl → ACL rules
       ├── /api/audit → Audit log
       ├── /api/mesh/nodes → Mesh topology
       ├── /api/meter/cost → Metering data
       ├── /api/settings/runtime → Runtime config
       └── / → Dashboard UI
```

## Features

### CASA List

The home page shows all CASAs with their status, port, and tags. Cards update every 5 seconds via polling. You can stop or kill running CASAs directly from the UI.

### CASA Detail

Click a CASA card to see detailed information: port, workspace path, start time, tags, sessions, and raw configuration. Actions (stop, kill, chat) are available from the detail view.

### Chat

Send messages to a running CASA via the built-in chat interface. Messages are streamed back via SSE for real-time display. Session continuity is maintained across messages.

### Mesh Topology

View all registered peer nodes with their host, port, fingerprint, and managed status.

### ACL Rules

Browse all ACL rules showing source, target, and granted capabilities.

### Audit Log

View the last 100 audit entries with tool name, client, result status, and latency. Auto-refreshes every 10 seconds.

### Metering

The home page shows today's request count, cost, token usage, and average latency. Auto-refreshes every 30 seconds.

### Settings

View node configuration and runtime port assignments.

### Real-time Events

The dashboard subscribes to runtime events via SSE (`/api/events`). Connection limits (max 10) and heartbeat keep-alive (15s) are enforced.

### Dark Mode

Toggle between light and dark themes using the button in the top bar. The dashboard respects your system preference by default.

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/casas` | GET | List all CASAs (token redacted) |
| `/api/casas/[name]` | GET | Get CASA status (token redacted) |
| `/api/casas/[name]` | DELETE | Kill a CASA |
| `/api/casas/[name]/stop` | POST | Graceful stop |
| `/api/casas/[name]/kill` | POST | Force kill |
| `/api/casas/[name]/chat` | POST | Chat via SSE stream |
| `/api/casas/[name]/sessions` | GET | List sessions |
| `/api/casas/[name]/sessions/[id]` | GET | Get session detail |
| `/api/events` | GET | SSE event stream |
| `/api/acl` | GET | List ACL rules |
| `/api/audit` | GET | Read audit log (`?limit=N`) |
| `/api/mesh/nodes` | GET | List mesh nodes (apiKey redacted) |
| `/api/meter/cost` | GET | Query metering data (`?casa=name`) |
| `/api/settings/runtime` | GET | Runtime port configuration |

## Security

- **Localhost only**: Middleware rejects requests from non-localhost hosts (DNS rebinding protection)
- **CSRF protection**: Origin header validated on state-changing requests
- **Secret redaction**: Bearer tokens and API keys are stripped from API responses
- **Error sanitization**: Internal error messages are not exposed to clients

## Options

| Option | Default | Description |
|--------|---------|-------------|
| `--port` | 3457 | Dashboard port |
| `--host` | 127.0.0.1 | Bind address |
| `--open` | false | Open browser after starting |
