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
│  Lock: $MECHA_DIR/.daemon.lock (flock)            │
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

1. Acquire exclusive `flock` on `$MECHA_DIR/.daemon.lock`
2. If lock fails → daemon already running, print URL and exit
3. Write `daemon.json`: `{ pid, port, startedAt, version }`
4. Start Hono HTTP server (current dashboard-server.ts)
5. Start reconciliation loop
6. Log to `$MECHA_DIR/logs/daemon.log`

**Auto-start:** Any CLI command that needs the fleet API (`spawn`, `ls`, `query`, `costs`, etc.) checks if daemon is running. If not, auto-starts in background.

```typescript
async function ensureDaemon(): Promise<string> {
  const url = getDaemonUrl();
  if (url) return url; // already running
  // Auto-start in background
  spawn(process.execPath, [cliPath, "daemon", "start", "--background"], {
    detached: true, stdio: "ignore"
  }).unref();
  // Wait for daemon.json to appear (max 5s, exponential backoff)
  return waitForDaemon();
}
```

**Stop:**
```bash
mecha daemon stop
```

1. Read `daemon.json` for PID
2. Send SIGTERM
3. Daemon receives SIGTERM:
   - Update `daemon.json` status to `stopping`
   - Stop accepting new connections
   - Drain active SSE connections (5s timeout)
   - Stop reconciliation loop
   - Remove `daemon.json`
   - Release flock
   - Exit 0
4. If no response after 10s, send SIGKILL

**Status:**
```bash
mecha daemon status
```

Returns: running/stopped, PID, port, uptime, bot count, version.

**Discovery — how clients find the daemon:**
1. `MECHA_URL` env var (explicit override)
2. Read `$MECHA_DIR/daemon.json` for port
3. Default `http://localhost:7700`

Bots receive `MECHA_FLEET_URL` env var at spawn (read from daemon.json).

### Singleton Enforcement

Use `flock(LOCK_EX | LOCK_NB)` on `$MECHA_DIR/.daemon.lock`. This is the most reliable cross-platform method:
- If flock succeeds → no daemon running, safe to start
- If flock fails → daemon is running (even if daemon.json is stale)
- On daemon crash, the OS automatically releases the flock
- No PID reuse false positives (unlike kill-based checks)

### Reconciliation Loop

Runs every 30 seconds inside the daemon. Compares desired state (registry) to actual state (Docker containers):

```
for each bot in registry:
  container = docker.inspect("mecha-{name}")
  if container is null:
    log("orphan registry entry: {name}")
  if container.status == "exited" && bot.restartPolicy == "unless-stopped":
    docker.start(name)  // self-healing restart
    log("auto-restarted {name}")

for each container matching "mecha-*":
  if not in registry:
    log("orphan container: {name}")
```

Emits structured events to audit log for every corrective action.

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

### Migration from Current Architecture

The current `mecha dashboard` command becomes `mecha daemon start --foreground`. For backward compatibility, `mecha dashboard` is kept as an alias. All fleet API routes stay the same — no breaking changes for the dashboard frontend.

### Files to Create/Modify

| File | Change |
|------|--------|
| `src/daemon.ts` | **New**: daemon lifecycle (start, stop, flock, signal handling, reconciler) |
| `src/commands/daemon.ts` | **New**: `mecha daemon start/stop/status` CLI commands |
| `src/cli.ts` | Add `ensureDaemon()` call before fleet-dependent commands; alias `dashboard` to `daemon start` |
| `src/docker.utils.ts` | Add `MECHA_FLEET_URL` to container env vars |
| `src/dashboard-server.ts` | Add `/api/health` endpoint |

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

The `permissions.fleet_control` field is checked at tool registration time — if false or absent, fleet tools are not registered in the bot's MCP server.

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
| `mecha_fleet_config` | name, field?, set? | View or edit bot config |
| `mecha_fleet_status` | none | Fleet health summary |

All tools proxy to the fleet daemon API at `MECHA_FLEET_URL` using `MECHA_FLEET_INTERNAL_SECRET`.

### Security Guards

**Per-operation limits:**
- Cannot remove self (tool rejects `name === MECHA_BOT_NAME`)
- Max 5 spawns per hour (tracked in memory, reset hourly)
- Max 20 fleet operations per hour (prevents runaway automation)
- Spawned bots inherit a budget ceiling (default $1/day unless specified)

**Audit trail:**
Every fleet tool call emits a structured event:
```json
{
  "type": "fleet_operation",
  "actor": "bot:orchestrator",
  "action": "spawn",
  "target": "data-analyst",
  "params": { "model": "sonnet", "system": "..." },
  "result": "success",
  "timestamp": "2026-03-17T12:00:00Z"
}
```

**Fleet-wide circuit breaker:**
If >3 fleet operations fail in 5 minutes, fleet tools are disabled for 10 minutes (returns error "Fleet operations temporarily paused due to repeated failures"). The orchestrator bot receives this as a tool error and can explain it to callers.

### Bot Config Schema Change

Add `permissions` to `botConfigSchema` in `agent/types.ts`:

```typescript
permissions: z.object({
  fleet_control: z.boolean().default(false),
}).optional().default({}),
```

### How Regular Bots Request Fleet Actions

Regular bots use the existing `mecha_call` tool:

```
Bot "reviewer": mecha_call("orchestrator", "Please spawn a bot named 'data-analyst' with system prompt 'You analyze data trends' using model sonnet")
```

The orchestrator interprets the request, validates it against policies, and executes using fleet tools. This provides a natural language permission layer — the orchestrator can refuse requests that violate policies.

### Files to Create/Modify

| File | Change |
|------|--------|
| `agent/tools/mecha-fleet.ts` | **New**: fleet MCP tool implementations |
| `agent/tools/mecha-server.ts` | Register fleet tools when `fleet_control: true` |
| `agent/types.ts` | Add `permissions` to bot config schema |
| `src/docker.utils.ts` | Pass `MECHA_FLEET_URL` env var to containers |

---

## Phase Dependency

```
Phase 1 (Daemon) ──> Phase 2 (Orchestrator)
                      └── depends on MECHA_FLEET_URL being discoverable
```

Phase 1 must ship first — the orchestrator needs a stable fleet API endpoint.

## What This Does NOT Include

- Web UI for orchestrator management (use CLI or bot conversation)
- Multi-node daemon clustering (single daemon per host)
- Persistent job queue (fleet operations are synchronous)
- Custom tool plugins for orchestrator (use mecha_call for extensibility)
