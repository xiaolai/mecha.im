# Singleton Daemon + Orchestrator Bot Design

## Summary

Transform mecha from a stateless CLI into a daemon-managed fleet controller with an orchestrator bot that can programmatically manage the fleet via MCP tools.

Two phases, implemented sequentially:
1. **Daemon Mode** — singleton process managing fleet lifecycle with reconciliation loop
2. **Orchestrator Bot** — privileged bot with fleet MCP tools for programmatic fleet management

---

## Phase 1: Singleton Daemon

### Architecture

```
┌─────────────────────────────────────────────────┐
│                 mecha daemon                      │
│                                                   │
│  ┌──────────┐  ┌──────────────┐  ┌────────────┐ │
│  │ HTTP API  │  │ Reconciler   │  │ Audit Log  │ │
│  │ (Hono)    │  │ (30s loop)   │  │ (JSONL)    │ │
│  └──────────┘  └──────────────┘  └────────────┘ │
│  ┌──────────┐  ┌──────────────┐                  │
│  │ Dashboard │  │ Docker API   │                  │
│  │ (static)  │  │ (dockerode)  │                  │
│  └──────────┘  └──────────────┘                  │
│                                                   │
│  Lock: $MECHA_DIR/.daemon.lock (directory lock)   │
│  State: $MECHA_DIR/daemon.json (port, pid, start) │
│  Logs: $MECHA_DIR/logs/daemon.log                 │
└─────────────────────────────────────────────────┘
```

### Daemon Lifecycle

**Start:**
```bash
mecha daemon start              # foreground
mecha daemon start --background # detached (default for auto-start)
```

1. Acquire exclusive directory lock on `$MECHA_DIR/.daemon.lock` (same pattern as registry lock — `mkdirSync` + stale detection)
2. If lock fails → daemon already running, print URL and exit
3. Bind HTTP server to port (default 7700). If port in use, fail with clear error.
4. Write `daemon.json`: `{ pid, port, startedAt, version, status: "ready" }`
5. Start Hono HTTP server (current dashboard-server.ts)
6. Start reconciliation loop
7. Log to `$MECHA_DIR/logs/daemon.log`

**Auto-start:** Any CLI command that needs the daemon (`spawn`, `stop`, `restart`, `rm`, `ls`, `schedule`, `webhooks`) checks if daemon is running via `daemon.json` + health probe. If not, auto-starts in background.

Commands that do NOT need the daemon (direct to Docker or filesystem):
- `query` — talks directly to bot container
- `exec` — talks directly to Docker
- `logs` — talks directly to Docker
- `config` — reads filesystem
- `costs` — reads filesystem
- `sessions` — talks directly to bot container
- `auth` — reads/writes filesystem
- `ssh-key` — reads/writes filesystem
- `doctor` — probes directly
- `completion` — static output

```typescript
async function ensureDaemon(): Promise<string> {
  const url = getDaemonUrl();
  if (url) {
    // Verify it's actually alive
    try {
      const r = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(2000) });
      if (r.ok) return url;
    } catch { /* daemon.json stale */ }
  }
  // Auto-start in background
  const child = spawn(process.execPath, [cliPath, "daemon", "start", "--background"], {
    detached: true, stdio: "ignore"
  });
  child.unref();
  // Wait for daemon.json with status "ready" (max 10s, exponential backoff)
  return waitForDaemon();
}
```

**Stop:**
```bash
mecha daemon stop
```

1. Read `daemon.json` for PID
2. Verify PID is alive and is a mecha process (check start time)
3. Send SIGTERM
4. Daemon receives SIGTERM:
   - Update `daemon.json` status to `stopping`
   - Stop reconciliation loop
   - Stop accepting new connections
   - Wait for active SSE streams to close (5s timeout, then force close)
   - Remove `daemon.json`
   - Release directory lock (`rmdirSync`)
   - Exit 0
5. CLI polls `daemon.json` removal (max 10s). If still exists, send SIGKILL.

**Status:**
```bash
mecha daemon status
```

Probes `/api/health`, falls back to `daemon.json` + PID check. Returns: running/stopped, PID, port, uptime, bot count, version.

**Backward compatibility:** `mecha dashboard` becomes alias for `mecha daemon start --foreground`. Keeps `--port` flag. Still opens browser on macOS/Linux.

### Discovery — How Clients Find the Daemon

1. `MECHA_URL` env var (explicit override)
2. Read `$MECHA_DIR/daemon.json` for port
3. Default `http://localhost:7700`

### Container-to-Daemon Networking

Bots inside Docker containers cannot reach `localhost:7700` on the host. Solution:

**macOS (Docker Desktop / Colima):** `host.docker.internal` resolves to the host IP. Set `MECHA_FLEET_URL=http://host.docker.internal:{port}`.

**Linux:** Use Docker bridge gateway IP (`172.17.0.1` by default). Detect at spawn time:
```typescript
const gatewayIp = await getDockerGatewayIp(); // docker network inspect bridge
const fleetUrl = `http://${gatewayIp}:${port}`;
```

**Bind address:** Daemon must bind to `0.0.0.0` (not `127.0.0.1`) when bots need to reach it. Add `--host` flag: `mecha daemon start --host 0.0.0.0`.

Only the orchestrator bot receives `MECHA_FLEET_URL`. Regular bots do NOT get this env var — they cannot call the daemon directly.

### Singleton Enforcement

Use directory-based lock (same pattern as existing `withRegistryLock` in store.ts):
- `mkdirSync($MECHA_DIR/.daemon.lock)` — atomic on POSIX
- Stale detection via `statSync().mtimeMs` (30s threshold)
- `rmdirSync` on graceful shutdown
- On crash, stale detection handles cleanup on next start

This reuses the proven cross-platform pattern already in the codebase. No new dependencies needed.

### Registry Schema: Desired State

Add `desired_state` to bot registry entries to distinguish intentional stops from crashes:

```typescript
interface BotEntry {
  // existing fields...
  path: string;
  config: string;
  containerId: string;
  model: string;
  botToken: string;
  createdAt: string;
  // new fields
  desired_state: "running" | "stopped" | "removed";  // default: "running"
}
```

Update commands:
- `mecha spawn` → sets `desired_state: "running"`
- `mecha stop` → sets `desired_state: "stopped"`
- `mecha start` → sets `desired_state: "running"`
- `mecha rm` → sets `desired_state: "removed"` (then deletes entry)

Migration: existing entries without `desired_state` default to current Docker container state.

### Reconciliation Loop

Runs every 30 seconds inside the daemon:

```
for each bot in registry where desired_state == "running":
  container = docker.inspect("mecha-{name}")
  if container is null or container.status == "exited":
    docker.start(name)  // self-healing restart
    audit("auto-restarted {name}", { reason: "desired_state=running but container exited" })

for each bot in registry where desired_state == "stopped":
  container = docker.inspect("mecha-{name}")
  if container.status == "running":
    // Unexpected — log but don't act (operator may have started manually)
    audit("drift detected: {name} running but desired_state=stopped")

for each container matching "mecha-*" not in registry:
  audit("orphan container: {name}")
```

The reconciler is read-heavy, write-light. It only takes corrective action for `desired_state: "running"` bots that have stopped. It never stops a running bot — only logs drift.

### Daemon Auth Model

Two separate auth paths:

1. **Dashboard auth** (existing): session cookies + bearer token for human users via browser/CLI
2. **Fleet internal auth** (new): `MECHA_FLEET_INTERNAL_SECRET` in `Authorization: Bearer` header — accepted ONLY from `fleet_control: true` bots

The daemon validates fleet internal auth on a new middleware path:

```typescript
app.use("/api/fleet/*", async (c, next) => {
  const auth = c.req.header("authorization");
  if (!auth || !auth.startsWith("Bearer ")) return c.json({ error: "Unauthorized" }, 401);
  const token = auth.slice(7);
  if (!constantTimeEquals(token, fleetInternalSecret)) return c.json({ error: "Unauthorized" }, 401);
  await next();
});
```

Fleet API routes (`/api/fleet/*`) are separate from dashboard routes (`/api/*`). Dashboard auth cannot access fleet routes. Fleet auth cannot access dashboard routes.

### Fleet API Routes (Phase 1 deliverable)

Add to dashboard-server.ts under `/api/fleet/` prefix (fleet-internal auth only):

| Route | Method | Description |
|-------|--------|-------------|
| `/api/fleet/bots` | GET | List all bots with status |
| `/api/fleet/bots` | POST | Spawn a new bot |
| `/api/fleet/bots/:name/start` | POST | Start a bot |
| `/api/fleet/bots/:name/stop` | POST | Stop a bot |
| `/api/fleet/bots/:name/restart` | POST | Restart a bot |
| `/api/fleet/bots/:name` | DELETE | Remove a bot |
| `/api/fleet/bots/:name/config` | GET | View bot config |
| `/api/fleet/bots/:name/config` | PUT | Edit bot config |
| `/api/fleet/costs` | GET | Fleet cost summary |
| `/api/fleet/costs/:name` | GET | Per-bot cost detail |
| `/api/fleet/health` | GET | Fleet health (same as /api/health) |

These mirror the CLI commands but over HTTP, authenticated with fleet secret.

### Signal Handling

| Signal | Action |
|--------|--------|
| SIGTERM | Graceful shutdown (drain + cleanup) |
| SIGINT (first) | Same as SIGTERM |
| SIGINT (second) | Immediate exit |
| SIGHUP | Reload config (re-read settings, reconnect Docker) |

### Health Endpoint

`GET /api/health` (unauthenticated):

```json
{
  "status": "ok",
  "version": "0.3.4",
  "uptime": 3600,
  "bots": { "running": 5, "stopped": 2 },
  "pid": 12345
}
```

### Audit Log

File: `$MECHA_DIR/logs/daemon-audit.jsonl`
Rotation: 10MB max, keep 5 files (same as agent event-log.ts pattern)

Schema:
```json
{
  "ts": "2026-03-17T12:00:00Z",
  "actor": "daemon:reconciler",
  "action": "auto-restart",
  "target": "reviewer",
  "detail": { "reason": "container exited", "exit_code": 1 },
  "result": "success"
}
```

Actors: `daemon:reconciler`, `daemon:shutdown`, `fleet:orchestrator`, `cli:<command>`.

### Files to Create/Modify

| File | Change |
|------|--------|
| `src/daemon.ts` | **New**: daemon lifecycle (start, stop, lock, signal handling, reconciler, audit) |
| `src/commands/daemon.ts` | **New**: `mecha daemon start/stop/status` CLI commands |
| `src/cli.ts` | Add `ensureDaemon()` before fleet-dependent commands; alias `dashboard` |
| `src/docker.utils.ts` | Add `MECHA_FLEET_URL` ONLY for `fleet_control: true` bots |
| `src/store.ts` | Add `desired_state` to registry schema + migration |
| `src/dashboard-server.ts` | Add `/api/health` and `/api/fleet/*` routes with fleet auth middleware |

### Phase 1 Build Order

1. Registry schema: add `desired_state` field + migration
2. Daemon lifecycle: lock, start, stop, signal handling
3. Fleet API routes + fleet auth middleware
4. Container networking: `MECHA_FLEET_URL` for fleet_control bots only
5. Reconciliation loop (depends on desired_state)
6. CLI integration: `ensureDaemon()`, `dashboard` alias
7. Health endpoint + `daemon status` command

---

## Phase 2: Orchestrator Bot

### Concept

A bot with `fleet_control: true` permission gets fleet management MCP tools. Regular bots request fleet actions through it via `mecha_call`.

### Configuration

```yaml
name: orchestrator
system: |
  You are the fleet orchestrator. You manage bot lifecycle,
  monitor costs, and enforce policies. You can spawn, stop,
  and configure other bots.
model: sonnet
permissions:
  fleet_control: true
max_budget_usd: 1.00
```

The `permissions.fleet_control` field gates two things:
1. Fleet MCP tools registered in the bot's tool server
2. `MECHA_FLEET_URL` env var injected into the container

Regular bots get neither — they cannot call the daemon API.

### Fleet MCP Tools

Registered in `agent/tools/mecha-fleet.ts`, available only when `fleet_control: true`:

| Tool | Parameters | Description |
|------|-----------|-------------|
| `mecha_fleet_ls` | none | List all bots with status, model, uptime, cost |
| `mecha_fleet_spawn` | name, system, model?, auth? | Spawn a new bot |
| `mecha_fleet_stop` | name | Stop a bot |
| `mecha_fleet_start` | name | Start a stopped bot |
| `mecha_fleet_restart` | name | Restart a bot |
| `mecha_fleet_rm` | name | Remove a bot |
| `mecha_fleet_costs` | name?, period? | Get cost breakdown |
| `mecha_fleet_config` | name, field? | View bot config (read-only from tools) |
| `mecha_fleet_status` | none | Fleet health summary |

All tools proxy to `MECHA_FLEET_URL/api/fleet/*` using `MECHA_FLEET_INTERNAL_SECRET`.

`mecha_fleet_config` is read-only from tools (no `--set`). Config changes require CLI or dashboard — this prevents a prompt-injected orchestrator from silently reconfiguring bots.

### Security Guards

**Per-operation limits (in-memory, best-effort soft guards):**
- Cannot remove self (tool rejects `name === MECHA_BOT_NAME`)
- Max 5 spawns per hour
- Max 20 fleet operations per hour

These reset on bot restart. They are defense-in-depth, not hard policy — the daemon's fleet API is the actual enforcement point.

**Daemon-side enforcement (hard guards):**
- Fleet API validates bot name format
- Fleet API checks `desired_state` before acting (no double-start, no stop-already-stopped)
- All fleet API calls logged to daemon audit trail with actor identity

**Audit trail:**
Every fleet tool call emits a structured event to both the bot's event log AND the daemon's audit log:
```json
{
  "type": "fleet_operation",
  "actor": "bot:orchestrator",
  "action": "spawn",
  "target": "data-analyst",
  "params": { "model": "sonnet" },
  "result": "success",
  "timestamp": "2026-03-17T12:00:00Z"
}
```

### Bot Config Schema Change

Add `permissions` to `botConfigSchema` in `agent/types.ts`:

```typescript
permissions: z.object({
  fleet_control: z.boolean().default(false),
}).optional().default({}),
```

### MCP Server Permission Context

`createMechaToolServer()` in `agent/tools/mecha-server.ts` currently receives only `SessionManager`. It needs the bot config to check permissions:

```typescript
export function createMechaToolServer(
  sessions: SessionManager,
  config: BotConfig,  // NEW: pass config for permission checks
): Server {
  // ... existing tools ...
  if (config.permissions?.fleet_control) {
    registerFleetTools(server);  // from mecha-fleet.ts
  }
}
```

Update caller in `agent/server.ts` to pass `config`.

### How Regular Bots Request Fleet Actions

Regular bots use the existing `mecha_call` tool:

```
Bot "reviewer": mecha_call("orchestrator", "spawn a bot named data-analyst with system prompt 'You analyze data' using sonnet")
```

The orchestrator interprets, validates, executes. This is a natural language permission layer.

### Files to Create/Modify

| File | Change |
|------|--------|
| `agent/tools/mecha-fleet.ts` | **New**: fleet MCP tool implementations |
| `agent/tools/mecha-server.ts` | Accept `BotConfig`, register fleet tools conditionally |
| `agent/server.ts` | Pass `config` to `createMechaToolServer()` |
| `agent/types.ts` | Add `permissions` to bot config schema |
| `src/docker.utils.ts` | Pass `MECHA_FLEET_URL` ONLY when `fleet_control: true` |

---

## Phase Dependency

```
Phase 1 (Daemon)
  1. Registry desired_state schema
  2. Daemon lifecycle + lock
  3. Fleet API routes + fleet auth
  4. Container networking (MECHA_FLEET_URL)
  5. Reconciliation loop
  6. CLI integration
      │
      v
Phase 2 (Orchestrator)
  1. Bot config permissions schema
  2. MCP server permission context
  3. Fleet MCP tool implementations
  4. MECHA_FLEET_URL injection for fleet_control bots
```

Phase 2 depends on: fleet API routes (Phase 1.3), fleet auth (Phase 1.3), and container networking (Phase 1.4).

## What This Does NOT Include

- Web UI for orchestrator management (use CLI or bot conversation)
- Multi-node daemon clustering (single daemon per host)
- Persistent job queue (fleet operations are synchronous)
- Custom tool plugins for orchestrator (use mecha_call for extensibility)
- Config editing from fleet tools (security: read-only to prevent silent reconfig)
- Fleet-wide budget enforcement (per-bot only, via existing max_budget_usd)
