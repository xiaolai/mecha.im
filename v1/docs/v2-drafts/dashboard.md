# Dashboard Reference

## Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 15 (App Router) |
| UI | React 19 |
| Styling | Tailwind CSS v4 (CSS-only config, no tailwind.config.ts) |
| Components | shadcn/ui (Radix + CVA) |
| Icons | lucide-react |
| Chat | @assistant-ui/react v0.12 |
| Terminal | xterm.js |
| Dark mode | next-themes (`.dark` class strategy) |

## Pages

### `/login`

Authentication page. Accepts Claude Code OAuth token.

### `/(dashboard)/`

Main dashboard (authenticated layout). Shows Mecha list or onboarding if none exist.

### `/(dashboard)/create`

Create new Mecha form with project path, environment variables, and permission mode.

## Dashboard Components

### Sidebar

- Mecha list with status indicators (running/stopped/error)
- Node labels for mesh-distributed mechas
- Search/filter
- Quick actions (start, stop)

### Tabs (per Mecha)

| Tab | Description |
|-----|-------------|
| **Chat** | Session list + message streaming via @assistant-ui/react |
| **Overview** | Mecha metadata, environment, logs preview |
| **Terminal** | Full xterm.js terminal with resize support |
| **Inspect** | Raw Docker container data |

### Chat Features

- Session list with create/delete/rename
- Real-time SSE message streaming
- Tool call rendering (@assistant-ui/react tool fallback)
- Session starring

## API Routes

### Authentication

| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/auth/login` | Authenticate with OAuth token |
| POST | `/api/auth/logout` | Clear auth session |

### Mecha Management

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/mechas` | List all mechas (local + remote nodes) |
| POST | `/api/mechas` | Create new Mecha |
| GET | `/api/mechas/[id]` | Get Mecha details |
| POST | `/api/mechas/[id]/start` | Start Mecha |
| POST | `/api/mechas/[id]/stop` | Stop Mecha |
| POST | `/api/mechas/[id]/restart` | Restart Mecha |
| POST | `/api/mechas/[id]/update` | Pull latest image and recreate |
| POST | `/api/mechas/[id]/env` | Update environment variables |
| DELETE | `/api/mechas/[id]` | Delete Mecha |

### Sessions

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/mechas/[id]/sessions` | List sessions |
| POST | `/api/mechas/[id]/sessions` | Create new session |
| GET | `/api/mechas/[id]/sessions/[sid]` | Get session with messages |
| DELETE | `/api/mechas/[id]/sessions/[sid]` | Delete session |
| POST | `/api/mechas/[id]/sessions/[sid]/message` | Send message (SSE) |
| POST | `/api/mechas/[id]/sessions/[sid]/interrupt` | Interrupt active session |
| POST | `/api/mechas/[id]/sessions/[sid]/config` | Update session config |

### Runtime

| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/mechas/[id]/chat` | Direct chat (SSE streaming) |
| POST | `/api/mechas/[id]/exec` | Execute command in container |
| GET | `/api/mechas/[id]/inspect` | Raw container inspection |
| GET | `/api/mechas/[id]/logs` | Stream container logs |
| GET | `/api/mechas/[id]/mcp` | Get MCP endpoint info |

### Terminal

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/mechas/[id]/terminal` | Establish terminal session |
| POST | `/api/mechas/[id]/terminal/input` | Send terminal input |
| POST | `/api/mechas/[id]/terminal/resize` | Resize terminal |

### System

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/mechas/events` | SSE stream for lifecycle events |
| GET | `/api/doctor` | System health check |
| POST | `/api/prune` | Remove stopped containers |

## Key Patterns

### Node-Aware API Proxy

Dashboard API routes detect whether a Mecha is local or remote (via `MechaLocator`), then either call the Docker client directly or proxy via `agentFetch()` to the remote agent server.

### SSE Event Relay

`/api/mechas/events` aggregates Docker container events from the local daemon and relays them as Server-Sent Events to the browser for real-time status updates.

### In-Memory Sessions (Known Limitation)

Dashboard authentication uses in-memory sessions (`packages/dashboard/src/lib/auth.ts`). This is single-process only. For multi-instance deployment, replace with signed JWT or Redis sessions.
