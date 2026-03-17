# Singleton Daemon — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform mecha into a singleton daemon that manages fleet lifecycle with a reconciliation loop, health endpoint, fleet API, and auto-start.

**Architecture:** The existing `dashboard-server.ts` becomes the core of the daemon. A new `daemon.ts` module wraps it with singleton enforcement (directory lock), signal handling, and a reconciliation loop. The registry schema gains `desired_state` for self-healing. Fleet API routes under `/api/fleet/*` use a separate auth path from the dashboard.

**Tech Stack:** TypeScript, Hono, dockerode, Commander.js (existing stack — no new dependencies)

**Spec:** `docs/superpowers/specs/2026-03-17-daemon-orchestrator-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/store.ts` | Modify | Add `desired_state` to registry schema + migration |
| `src/daemon.ts` | Create | Daemon lifecycle: lock, start, stop, signal handling, reconciler |
| `src/daemon-audit.ts` | Create | Structured JSONL audit logging with rotation |
| `src/commands/daemon.ts` | Create | `mecha daemon start/stop/status` CLI commands |
| `src/dashboard-server.ts` | Modify | Add `/api/health` and `/api/fleet/*` routes with fleet auth |
| `src/docker.utils.ts` | Modify | Inject `MECHA_FLEET_URL` for fleet_control bots; detect gateway IP |
| `src/docker.ts` | Modify | Update spawn/start/stop/rm to set `desired_state` in registry |
| `src/cli.ts` | Modify | Add `ensureDaemon()`, register daemon commands, alias dashboard |

---

## Task 1: Registry desired_state schema

**Files:**
- Modify: `src/store.ts`

- [ ] **Step 1: Add `desired_state` to registry bot entry schema**

In `store.ts`, update `registrySchema.bots` to include:

```typescript
desired_state: z.enum(["running", "stopped", "removed"]).optional(),
```

Bump `REGISTRY_SCHEMA_VERSION` to 2.

- [ ] **Step 2: Update setBot to accept desired_state**

No change needed — `setBot` already writes the full entry object. Callers will pass `desired_state` when they call it.

- [ ] **Step 3: Add helper `setBotDesiredState(name, state)`**

```typescript
export function setBotDesiredState(name: string, state: "running" | "stopped" | "removed"): void {
  withRegistryLock(() => {
    const reg = readRegistry();
    if (!reg.bots[name]) return;
    reg.bots[name].desired_state = state;
    reg.schema_version = REGISTRY_SCHEMA_VERSION;
    atomicWriteJson(registryPath(), reg);
  });
}
```

- [ ] **Step 4: Update docker.ts — spawn sets desired_state: "running"**

In `src/docker.ts`, in `spawnUnlocked()` where `setBot()` is called, add `desired_state: "running"` to the entry.

- [ ] **Step 5: Update docker.ts — stop sets desired_state: "stopped"**

In `stop()`, after `container.stop()`, call `setBotDesiredState(name, "stopped")`.

- [ ] **Step 6: Update docker.ts — start sets desired_state: "running"**

In `start()`, after `container.start()`, call `setBotDesiredState(name, "running")`.

- [ ] **Step 7: Update docker.ts — remove sets desired_state: "removed"**

In `remove()`, before `removeBot(name)`, set `desired_state: "removed"`.

- [ ] **Step 8: Commit**

```bash
git add src/store.ts src/docker.ts
git commit -m "feat(daemon): add desired_state to registry schema for reconciliation"
```

---

## Task 2: Daemon audit log

**Files:**
- Create: `src/daemon-audit.ts`

- [ ] **Step 1: Create audit logger**

```typescript
import { appendFileSync, statSync, renameSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getMechaDir } from "./store.js";

const MAX_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_FILES = 5;

function auditPath(): string {
  return join(getMechaDir(), "logs", "daemon-audit.jsonl");
}

export function auditLog(event: {
  actor: string;
  action: string;
  target?: string;
  detail?: Record<string, unknown>;
  result: "success" | "failure" | "skipped";
}): void {
  const path = auditPath();
  mkdirSync(join(getMechaDir(), "logs"), { recursive: true });
  const line = JSON.stringify({ ts: new Date().toISOString(), ...event }) + "\n";
  appendFileSync(path, line);
  // Rotate if needed
  try {
    if (statSync(path).size > MAX_SIZE) {
      for (let i = MAX_FILES - 1; i >= 1; i--) {
        try { renameSync(`${path}.${i}`, `${path}.${i + 1}`); } catch {}
      }
      renameSync(path, `${path}.1`);
    }
  } catch {}
}
```

- [ ] **Step 2: Commit**

```bash
git add src/daemon-audit.ts
git commit -m "feat(daemon): add structured JSONL audit logger with rotation"
```

---

## Task 3: Daemon lifecycle

**Files:**
- Create: `src/daemon.ts`

- [ ] **Step 1: Create daemon module with lock, start, stop, signal handling**

The daemon module manages:
- Directory-based singleton lock (`$MECHA_DIR/.daemon.lock`)
- `daemon.json` state file (pid, port, startedAt, version, status)
- Signal handling (SIGTERM, SIGINT, SIGHUP)
- Reconciliation loop (30s interval)
- Graceful shutdown (drain SSE, remove state, release lock)

Key functions:
- `startDaemon(port, host, foreground)` — main entry
- `stopDaemon()` — read daemon.json, send SIGTERM
- `getDaemonStatus()` — probe health or read state file
- `getDaemonUrl()` — discover running daemon URL
- `ensureDaemon()` — auto-start if not running, return URL

The reconciler reads registry, compares with Docker state, auto-restarts bots where `desired_state === "running"` but container is exited.

- [ ] **Step 2: Commit**

```bash
git add src/daemon.ts
git commit -m "feat(daemon): singleton daemon with lock, reconciler, and signal handling"
```

---

## Task 4: Fleet API routes + auth middleware

**Files:**
- Modify: `src/dashboard-server.ts`

- [ ] **Step 1: Add `/api/health` endpoint (unauthenticated)**

```typescript
app.get("/api/health", async (c) => {
  const bots = await docker.list();
  const running = bots.filter(b => b.status === "running").length;
  const stopped = bots.length - running;
  return c.json({
    status: "ok",
    version: readVersion(),
    uptime: Math.floor((Date.now() - startedAt) / 1000),
    bots: { running, stopped },
    pid: process.pid,
  });
});
```

Add to unauthenticated path allowlist alongside `/api/totp/status`.

- [ ] **Step 2: Add fleet auth middleware**

```typescript
app.use("/api/fleet/*", async (c, next) => {
  const auth = c.req.header("authorization");
  if (!auth?.startsWith("Bearer ")) return c.json({ error: "Unauthorized" }, 401);
  const token = auth.slice(7);
  const secret = getOrCreateFleetInternalSecret();
  if (!constantTimeEquals(token, secret)) return c.json({ error: "Unauthorized" }, 401);
  await next();
});
```

- [ ] **Step 3: Add fleet API routes**

Routes under `/api/fleet/`:
- `GET /api/fleet/bots` — list all bots
- `POST /api/fleet/bots` — spawn a bot (body: name, system, model, auth)
- `POST /api/fleet/bots/:name/start` — start
- `POST /api/fleet/bots/:name/stop` — stop
- `POST /api/fleet/bots/:name/restart` — restart
- `DELETE /api/fleet/bots/:name` — remove
- `GET /api/fleet/bots/:name/config` — view config
- `GET /api/fleet/costs` — fleet costs
- `GET /api/fleet/costs/:name` — per-bot costs
- `GET /api/fleet/health` — alias for /api/health

Each route calls the corresponding docker.ts function and logs to audit trail.

- [ ] **Step 4: Commit**

```bash
git add src/dashboard-server.ts
git commit -m "feat(daemon): add /api/health and /api/fleet/* routes with fleet auth"
```

---

## Task 5: Container networking — MECHA_FLEET_URL

**Files:**
- Modify: `src/docker.utils.ts`

- [ ] **Step 1: Detect Docker gateway IP**

```typescript
export async function getDockerGatewayIp(): Promise<string> {
  try {
    const network = await docker.getNetwork("bridge").inspect();
    return network.IPAM?.Config?.[0]?.Gateway ?? "host.docker.internal";
  } catch {
    return "host.docker.internal"; // macOS/Docker Desktop fallback
  }
}
```

- [ ] **Step 2: Inject MECHA_FLEET_URL only for fleet_control bots**

In `buildContainerEnv()`, after existing env vars:

```typescript
if (config.permissions?.fleet_control) {
  const daemonUrl = getDaemonUrl(); // from daemon.ts
  if (daemonUrl) {
    // Replace localhost with gateway IP for container reachability
    const gatewayIp = await getDockerGatewayIp();
    const containerUrl = daemonUrl.replace("localhost", gatewayIp).replace("127.0.0.1", gatewayIp);
    env.push(`MECHA_FLEET_URL=${containerUrl}`);
  }
}
```

Note: `buildContainerEnv` needs to become async. Update caller in docker.ts.

- [ ] **Step 3: Commit**

```bash
git add src/docker.utils.ts src/docker.ts
git commit -m "feat(daemon): inject MECHA_FLEET_URL for fleet_control bots with gateway detection"
```

---

## Task 6: CLI integration

**Files:**
- Create: `src/commands/daemon.ts`
- Modify: `src/cli.ts`

- [ ] **Step 1: Create daemon CLI commands**

```typescript
export function registerDaemonCommand(program: Command): void {
  const daemon = program.command("daemon").description("Manage the mecha daemon");

  daemon.command("start")
    .description("Start the fleet daemon")
    .option("--port <port>", "Listen port", "7700")
    .option("--host <host>", "Bind address", "127.0.0.1")
    .option("--background", "Run in background")
    .action(async (opts) => { /* call startDaemon() */ });

  daemon.command("stop")
    .description("Stop the daemon")
    .action(async () => { /* call stopDaemon() */ });

  daemon.command("status")
    .description("Show daemon status")
    .option("--json", "JSON output")
    .action(async (opts) => { /* call getDaemonStatus() */ });
}
```

- [ ] **Step 2: Register in cli.ts + alias dashboard**

Import and call `registerDaemonCommand(program)`.

Update `dashboard` command to call `startDaemon(port, host, true)` (foreground mode).

- [ ] **Step 3: Add ensureDaemon() calls to fleet-dependent commands**

Add `await ensureDaemon()` before: `spawn`, `stop`, `start`, `restart`, `rm`, `ls`, `schedule`, `webhooks`.

Do NOT add to: `query`, `exec`, `logs`, `config`, `costs`, `sessions`, `auth`, `ssh-key`, `doctor`, `completion`.

- [ ] **Step 4: Commit**

```bash
git add src/commands/daemon.ts src/cli.ts
git commit -m "feat(daemon): add daemon start/stop/status CLI commands with auto-start"
```

---

## Task 7: Build, verify, type check

- [ ] **Step 1: Type check**

```bash
npx tsc -b --noEmit
```

- [ ] **Step 2: Build**

```bash
npx tsc -b --clean && npx tsc -b
```

- [ ] **Step 3: Verify daemon commands**

```bash
node dist/src/cli.js daemon --help
node dist/src/cli.js daemon start --help
node dist/src/cli.js daemon stop --help
node dist/src/cli.js daemon status --help
```

- [ ] **Step 4: Verify auto-start works**

```bash
# Ensure no daemon is running
node dist/src/cli.js daemon stop 2>/dev/null
# Run a fleet-dependent command — should auto-start daemon
MECHA_DIR=/tmp/mecha-test node dist/src/cli.js ls
# Verify daemon.json was created
cat /tmp/mecha-test/daemon.json
```

- [ ] **Step 5: Final commit**

```bash
git add -A && git commit -m "chore: Phase 1 daemon complete — type check and build verified"
```

---

## Phase 2 Summary (separate plan, separate branch)

After Phase 1 ships:

1. **Bot config permissions schema** — add `permissions.fleet_control` to `agent/types.ts`
2. **MCP server permission context** — pass `BotConfig` to `createMechaToolServer()` in `agent/server.ts`
3. **Fleet MCP tools** — create `agent/tools/mecha-fleet.ts` with 9 fleet tools proxying to `/api/fleet/*`
4. **MECHA_FLEET_URL injection** — only for `fleet_control: true` bots (Phase 1 Task 5 already handles this)
5. **Security guards** — rate limits, self-protection, audit logging
6. **Documentation** — update website docs with orchestrator guide

New files: `agent/tools/mecha-fleet.ts`
Modified: `agent/tools/mecha-server.ts`, `agent/server.ts`, `agent/types.ts`, `src/docker.utils.ts`
