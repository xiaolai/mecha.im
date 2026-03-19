# Native Runtime (Docker-Optional) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Docker optional by adding a native Node.js process manager, so users can spawn bots as plain child processes with `$HOME`/`$CWD`-based state directories.

**Architecture:** Extract a `ProcessManager` interface from the current Docker-only code. Implement `NativeProcessManager` using `child_process.spawn`. The agent code (`agent/entry.ts`) already uses env vars for all paths and requires zero changes. The CLI selects runtime via `--native` flag or global default. Registry gains `runtime` field to track which manager owns each bot.

**Tech Stack:** Node.js child_process, existing Hono agent server, existing registry/store

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/process-manager.ts` | **Create** | `ProcessManager` interface + factory function |
| `src/native.ts` | **Create** | `NativeProcessManager` — spawn/start/stop/restart/remove/list/logs via child_process |
| `src/native.utils.ts` | **Create** | PID file management, env builder for native mode |
| `src/docker.ts` | **Modify** | Conform to `ProcessManager` interface (rename exports → class methods) |
| `src/docker.utils.ts` | Minor | `withBotLock` is runtime-agnostic; keep in place |
| `src/docker.types.ts` | **Modify** | Add `runtime` field to `BotInfo` (canonical type, re-exported by `process-manager.ts`) |
| `src/store.ts` | **Modify** | Registry schema gains `runtime: "docker" \| "native"` + `pid` + `port` fields |
| `src/resolve-endpoint.ts` | **Modify** | Add native candidate path (read port from registry, probe localhost) |
| `src/cli.ts` | **Modify** | Add `--native` flag to `spawn`; route all commands through `ProcessManager` |
| `src/daemon.ts` | **Modify** | Reconciler uses `ProcessManager` instead of direct Docker calls |
| `src/dashboard-server.ts` | **Modify** | Use `ProcessManager` instead of `import * as docker` |
| `src/commands/auth.ts` | **Modify** | `auth swap` uses `getManagerForBot()` instead of direct Docker calls |
| `src/mcp-proxy.ts` | **Modify** | Use `listAllBots()` instead of `docker.list()` |
| `src/doctor.ts` | **Modify** | Add native health checks (PID alive + port probe) |
| `src/doctor.utils.ts` | **Modify** | Guard Docker-specific checks behind runtime check |
| `src/cli-utils.ts` | **Modify** | Import `BotInfo` from `process-manager.ts`; remove dockerode import |
| `src/dashboard-server-schema.ts` | **Modify** | Add `runtime` field to spawn body schema |
| `agent/routes/dashboard.ts` | **Modify** | Resolve `dist/` path via env var for native mode |
| `src/config.ts` | Minor | No changes needed |
| `agent/entry.ts` | Minor | Already env-var driven — no changes needed |
| `agent/paths.ts` | Minor | Already env-var driven — no changes needed |

---

### Task 1: ProcessManager Interface

**Files:**
- Create: `src/process-manager.ts`
- Modify: `src/docker.types.ts`

- [ ] **Step 1: Update BotInfo in docker.types.ts (canonical definition)**

Add `runtime` field to existing `BotInfo` — this stays the single source of truth:

```typescript
// src/docker.types.ts
export interface SpawnOptions {
  allowRegistryEntry?: boolean;
  replaceExisting?: boolean;
}

export interface BotInfo {
  name: string;
  status: string;
  model: string;
  containerId: string;
  ports: string;
  startedAt?: string;
  runtime?: "docker" | "native";
}
```

- [ ] **Step 2: Write the ProcessManager interface (re-exports BotInfo)**

```typescript
// src/process-manager.ts
import type { BotConfig } from "./config.js";
import type { BotInfo } from "./docker.types.js";

export type { BotInfo };
export type Runtime = "docker" | "native";

export interface ProcessManager {
  spawn(config: BotConfig, botPath?: string): Promise<string>;
  start(name: string): Promise<void>;
  stop(name: string): Promise<void>;
  restart(name: string): Promise<string>;
  remove(name: string): Promise<void>;
  list(): Promise<BotInfo[]>;
  logs(name: string, follow: boolean): Promise<void>;
  readonly runtime: Runtime;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/process-manager.ts src/docker.types.ts
git commit -m "feat: add ProcessManager interface for runtime abstraction"
```

---

### Task 2: Registry Schema — Add `runtime` and `pid`

**Files:**
- Modify: `src/store.ts`

- [ ] **Step 1: Update registry schema**

In `src/store.ts`, add `runtime` and `pid` fields to the bot entry schema:

```typescript
const registrySchema = z.object({
  schema_version: z.number().int().optional(),
  bots: z.record(z.string(), z.object({
    path: z.string(),
    config: z.string().optional(),
    containerId: z.string().optional(),
    pid: z.number().optional(),           // NEW: native process PID
    runtime: z.enum(["docker", "native"]).optional(),  // NEW: which manager owns this bot
    port: z.number().optional(),          // NEW: assigned port for native bots
    model: z.string().optional(),
    botToken: z.string().optional(),
    createdAt: z.string().optional(),
    desired_state: z.enum(["running", "stopped", "removed"]).optional(),
  })),
});
```

- [ ] **Step 2: Verify existing registries parse cleanly (all new fields optional)**

The new fields are optional with no defaults, so existing `registry.json` files parse without error. No migration needed.

- [ ] **Step 3: Commit**

```bash
git add src/store.ts
git commit -m "feat: registry schema adds runtime, pid, port fields"
```

---

### Task 3: Native Utilities — PID, Logs, Env

**Files:**
- Create: `src/native.utils.ts`

- [ ] **Step 1: Write PID file helpers**

```typescript
// src/native.utils.ts
import { readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";

export function writePidFile(botPath: string, pid: number): void {
  writeFileSync(join(botPath, "agent.pid"), String(pid));
}

export function readPidFile(botPath: string): number | null {
  try {
    const raw = readFileSync(join(botPath, "agent.pid"), "utf-8").trim();
    const pid = parseInt(raw, 10);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

export function removePidFile(botPath: string): void {
  try { unlinkSync(join(botPath, "agent.pid")); } catch { /* ok */ }
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 2: Write native env builder (async — mirrors buildContainerEnv)**

```typescript
// append to src/native.utils.ts
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveAuth, getPassthroughCredentials, getCredential } from "./auth.js";
import { getOrCreateFleetInternalSecret, readSettings } from "./store.js";
import { writeBotCredentials } from "./docker.utils.js";
import type { BotConfig } from "./config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function buildNativeEnv(config: BotConfig, botPath: string, botToken: string, port: number): Promise<Record<string, string>> {
  const auth = resolveAuth(config.auth);
  writeBotCredentials(botPath, config.auth);

  // Start from host env (native mode inherits host env — this covers
  // passthrough key fallback that buildContainerEnv does explicitly)
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    [auth.env]: auth.key,
    MECHA_BOT_NAME: config.name,
    MECHA_BOT_TOKEN: botToken,
    MECHA_STATE_DIR: botPath,
    MECHA_CONFIG_PATH: join(botPath, "bot.yaml"),
    MECHA_PORT: String(port),
    MECHA_FLEET_INTERNAL_SECRET: getOrCreateFleetInternalSecret(),
    MECHA_WORKSPACE_CWD: config.workspace ?? join(botPath, "workspace"),
    MECHA_ENABLE_PROJECT_SETTINGS: config.workspace ? "1" : "0",
    MECHA_DASHBOARD_ROOT: join(__dirname, "..", "agent", "dashboard", "dist"),
  };

  // Stored passthrough credentials override host env
  const passthroughKeys = ["OPENAI_API_KEY", "GEMINI_API_KEY", "XAI_API_KEY"];
  const passthrough = getPassthroughCredentials(passthroughKeys);
  for (const pt of passthrough) env[pt.env] = pt.key;

  // Tailscale
  if (config.tailscale) {
    if (config.tailscale.auth_key) {
      env.MECHA_TS_AUTH_KEY = config.tailscale.auth_key;
    } else if (config.tailscale.auth_key_profile) {
      const tsProfile = getCredential(config.tailscale.auth_key_profile);
      env.MECHA_TS_AUTH_KEY = tsProfile.key;
    }
    if (config.tailscale.login_server) {
      env.MECHA_TS_LOGIN_SERVER = config.tailscale.login_server;
    }
  }

  const settings = readSettings();
  if (settings.headscale_url) env.MECHA_HEADSCALE_URL = settings.headscale_url;
  if (settings.headscale_api_key) env.MECHA_HEADSCALE_API_KEY = settings.headscale_api_key;

  // Fleet URL for fleet_control bots (no Docker gateway needed — localhost works)
  const permissions = (config as Record<string, unknown>).permissions as Record<string, unknown> | undefined;
  if (permissions?.fleet_control) {
    const { getDaemonUrl } = await import("./daemon.js");
    const daemonUrl = getDaemonUrl();
    if (daemonUrl) env.MECHA_FLEET_URL = daemonUrl;
  }

  return env;
}
```

- [ ] **Step 3: Write log file helpers**

```typescript
// append to src/native.utils.ts
import { createWriteStream, type WriteStream } from "node:fs";
import { mkdirSync } from "node:fs";

export function openLogStream(botPath: string): WriteStream {
  const logDir = join(botPath, "logs");
  mkdirSync(logDir, { recursive: true });
  return createWriteStream(join(logDir, "agent.log"), { flags: "a" });
}
```

- [ ] **Step 4: Commit**

```bash
git add src/native.utils.ts
git commit -m "feat: native runtime utilities — PID, env, log helpers"
```

---

### Task 4: NativeProcessManager

**Files:**
- Create: `src/native.ts`

- [ ] **Step 1: Write the NativeProcessManager class**

```typescript
// src/native.ts
import { spawn as spawnChild, type ChildProcess } from "node:child_process";
import { mkdirSync, existsSync, writeFileSync, chmodSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { stringify as stringifyYaml } from "yaml";
import { log } from "../shared/logger.js";
import { getBot, setBot, removeBot, setBotDesiredState } from "./store.js";
import {
  BotAlreadyExistsError,
  BotAlreadyRunningError,
  BotNotFoundError,
  BotNotRunningError,
  ProcessSpawnError,
  ProcessHealthTimeoutError,
} from "../shared/errors.js";
import type { BotConfig } from "./config.js";
import { loadBotConfig } from "./config.js";
import { BOTS_BASE, HEALTH_CHECK_TIMEOUT_MS } from "./docker.constants.js";
import { validateBotPath, copyHostCodexAuth } from "./docker.utils.js";
import { getMutex } from "../shared/mutex.js";
import type { ProcessManager, BotInfo } from "./process-manager.js";
import {
  writePidFile, readPidFile, removePidFile, isProcessAlive,
  buildNativeEnv, openLogStream,
} from "./native.utils.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Find a free port by attempting to bind. Avoids TOCTOU race conditions. */
async function pickPort(startPort = 3100): Promise<number> {
  const { createServer } = await import("node:net");
  // Scan registry to skip known ports (fast path)
  const bots = listBots();
  const usedPorts = new Set<number>();
  for (const entry of Object.values(bots)) {
    if (entry.port) usedPorts.add(entry.port);
  }
  let port = startPort;
  while (usedPorts.has(port)) port++;

  // Verify the port is actually free by binding
  const maxAttempts = 100;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      await new Promise<void>((resolve, reject) => {
        const srv = createServer();
        srv.on("error", reject);
        srv.listen(port, "127.0.0.1", () => {
          srv.close(() => resolve());
        });
      });
      return port;
    } catch {
      port++;
    }
  }
  throw new ProcessSpawnError(`No free port found after ${maxAttempts} attempts starting from ${startPort}`);
}

/** Gracefully kill a process: SIGTERM → wait → SIGKILL */
async function killGracefully(pid: number, timeoutMs = 10_000): Promise<void> {
  if (!isProcessAlive(pid)) return;
  process.kill(pid, "SIGTERM");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 500));
    if (!isProcessAlive(pid)) return;
  }
  try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ }
}

export class NativeProcessManager implements ProcessManager {
  readonly runtime = "native" as const;

  async spawn(config: BotConfig, botPath?: string): Promise<string> {
    const mutex = getMutex(`bot:${config.name}`);
    const release = await mutex.acquire();
    try {
      return await this._spawn(config, botPath);
    } finally {
      release();
    }
  }

  private async _spawn(config: BotConfig, botPath?: string, opts?: { allowRegistryEntry?: boolean }): Promise<string> {
    const existingEntry = getBot(config.name);
    if (existingEntry && !opts?.allowRegistryEntry) {
      throw new BotAlreadyExistsError(config.name);
    }

    // Check if already running
    if (existingEntry?.pid && isProcessAlive(existingEntry.pid)) {
      throw new BotAlreadyExistsError(config.name);
    }

    const resolvedPath = validateBotPath(botPath ?? join(BOTS_BASE, config.name));

    // Create state directories (no need for 0o777 — same user)
    for (const sub of ["tasks", "sessions", "data", "logs", ".claude", ".codex", "workspace"]) {
      mkdirSync(join(resolvedPath, sub), { recursive: true });
    }

    const costsPath = join(resolvedPath, "costs.json");
    if (!existsSync(costsPath)) writeFileSync(costsPath, "{}\n");

    const configPath = join(resolvedPath, "bot.yaml");
    writeFileSync(configPath, stringifyYaml(config), { mode: 0o644 });

    const botToken = "mecha_" + randomBytes(24).toString("hex");
    const port = await pickPort();
    copyHostCodexAuth(resolvedPath);

    // Build env and spawn
    const env = await buildNativeEnv(config, resolvedPath, botToken, port);
    const entryScript = join(__dirname, "..", "agent", "entry.js");
    const logStream = openLogStream(resolvedPath);

    const child = spawnChild(process.execPath, [entryScript], {
      cwd: resolvedPath,
      env,
      stdio: ["ignore", logStream, logStream],
      detached: true,
    });
    child.unref();

    const pid = child.pid;
    if (!pid) {
      throw new ProcessSpawnError("Failed to spawn agent process");
    }
    writePidFile(resolvedPath, pid);

    // Health check
    let healthy = false;
    let delay = 200;
    const deadline = Date.now() + HEALTH_CHECK_TIMEOUT_MS;
    while (Date.now() < deadline) {
      try {
        const resp = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) });
        if (resp.ok) { healthy = true; break; }
      } catch { /* not ready yet */ }
      await new Promise(r => setTimeout(r, delay));
      delay = Math.min(delay * 2, 1000);
    }

    if (!healthy) {
      try { process.kill(pid, "SIGTERM"); } catch { /* may already be dead */ }
      removePidFile(resolvedPath);
      throw new ProcessHealthTimeoutError(config.name);
    }

    setBot(config.name, {
      path: resolvedPath,
      config: configPath,
      containerId: String(pid),   // store PID as containerId for backward compat
      pid,
      port,
      runtime: "native",
      model: config.model,
      botToken,
      createdAt: new Date().toISOString(),
      desired_state: "running",
    });

    return String(pid);
  }

  async start(name: string): Promise<void> {
    const mutex = getMutex(`bot:${name}`);
    const release = await mutex.acquire();
    try {
      const entry = getBot(name);
      if (!entry?.config) throw new BotNotFoundError(name);
      if (entry.pid && isProcessAlive(entry.pid)) throw new BotAlreadyRunningError(name);

      const config = loadBotConfig(entry.config);
      await this._spawn(config, entry.path, { allowRegistryEntry: true });
    } finally {
      release();
    }
  }

  async stop(name: string): Promise<void> {
    const entry = getBot(name);
    if (!entry) throw new BotNotFoundError(name);

    const pid = entry.pid ?? readPidFile(entry.path);
    if (!pid || !isProcessAlive(pid)) throw new BotNotRunningError(name);

    setBotDesiredState(name, "stopped");
    await killGracefully(pid);
    removePidFile(entry.path);
  }

  async restart(name: string): Promise<string> {
    const entry = getBot(name);
    if (!entry?.config) throw new BotNotFoundError(name);

    const pid = entry.pid ?? readPidFile(entry.path);
    if (pid && isProcessAlive(pid)) {
      await killGracefully(pid);
      removePidFile(entry.path);
    }

    const config = loadBotConfig(entry.config);
    return this._spawn(config, entry.path, { allowRegistryEntry: true });
  }

  async remove(name: string): Promise<void> {
    const entry = getBot(name);
    if (!entry) {
      removeBot(name);
      return;
    }

    const pid = entry.pid ?? readPidFile(entry.path);
    if (pid) await killGracefully(pid);
    if (entry.path) removePidFile(entry.path);
    removeBot(name);
  }

  async list(): Promise<BotInfo[]> {
    const bots = listBots();
    const result: BotInfo[] = [];

    for (const [name, entry] of Object.entries(bots)) {
      if (entry.runtime !== "native") continue;
      if (entry.desired_state === "removed") continue;
      const pid = entry.pid ?? readPidFile(entry.path);
      const alive = pid ? isProcessAlive(pid) : false;
      result.push({
        name,
        status: alive ? "running" : "exited",
        model: entry.model ?? "unknown",
        containerId: pid ? String(pid) : "unknown",
        ports: entry.port ? String(entry.port) : "",
        startedAt: alive ? entry.createdAt : undefined,
        runtime: "native",
      });
    }
    return result;
  }

  async logs(name: string, follow: boolean): Promise<void> {
    const entry = getBot(name);
    if (!entry?.path) throw new BotNotFoundError(name);
    const logPath = join(entry.path, "logs", "agent.log");

    if (follow) {
      const tail = spawnChild("tail", ["-f", logPath], { stdio: "inherit" });
      // Clean up tail process on exit signals
      const cleanup = () => { tail.kill(); };
      process.on("SIGINT", cleanup);
      process.on("SIGTERM", cleanup);
      await new Promise<void>((resolve) => {
        tail.on("exit", resolve);
      });
    } else {
      try {
        const content = readFileSync(logPath, "utf-8");
        const lines = content.split("\n");
        console.log(lines.slice(-200).join("\n"));
      } catch {
        console.log("No logs available");
      }
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/native.ts
git commit -m "feat: NativeProcessManager — spawn bots as child processes"
```

---

### Task 5: ProcessManager Factory

**Files:**
- Modify: `src/process-manager.ts`

- [ ] **Step 1: Add factory function and merged list**

Append to `src/process-manager.ts`:

```typescript
import * as docker from "./docker.js";
import { NativeProcessManager } from "./native.js";
import { getBot } from "./store.js";

const nativeManager = new NativeProcessManager();

// Docker module already exports functions matching the interface
// Wrap it in a thin adapter
const dockerAdapter: ProcessManager = {
  runtime: "docker",
  spawn: docker.spawn,
  start: docker.start,
  stop: docker.stop,
  restart: docker.restart,
  remove: docker.remove,
  list: async () => (await docker.list()).map(b => ({ ...b, runtime: "docker" as const })),
  logs: docker.logs,
};

export function getManager(runtime: Runtime): ProcessManager {
  return runtime === "native" ? nativeManager : dockerAdapter;
}

/** Get the correct manager for an existing bot by reading its registry entry */
export function getManagerForBot(name: string): ProcessManager {
  const entry = getBot(name);
  return getManager(entry?.runtime ?? "docker");
}

/** List all bots across both runtimes */
export async function listAllBots(): Promise<BotInfo[]> {
  const [dockerBots, nativeBots] = await Promise.all([
    dockerAdapter.list().catch(() => [] as BotInfo[]),
    nativeManager.list().catch(() => [] as BotInfo[]),
  ]);
  return [...dockerBots, ...nativeBots];
}
```

- [ ] **Step 2: Commit**

```bash
git add src/process-manager.ts
git commit -m "feat: ProcessManager factory + listAllBots across runtimes"
```

---

### Task 6: Agent Dashboard Path Resolution

**Files:**
- Modify: `agent/routes/dashboard.ts`

- [ ] **Step 1: Use MECHA_DASHBOARD_ROOT env var**

In `agent/routes/dashboard.ts`, update `DEFAULT_DASHBOARD_ROOT` to respect the env var:

```typescript
// Change line 8:
const DEFAULT_DASHBOARD_ROOT = process.env.MECHA_DASHBOARD_ROOT ?? "/app/agent/dashboard/dist";
```

This is the only agent-side change needed. Native mode sets `MECHA_DASHBOARD_ROOT` in the env to point to the installed package's `agent/dashboard/dist`.

- [ ] **Step 2: Commit**

```bash
git add agent/routes/dashboard.ts
git commit -m "feat: dashboard path configurable via MECHA_DASHBOARD_ROOT env"
```

---

### Task 7: Endpoint Resolution for Native Bots

**Files:**
- Modify: `src/resolve-endpoint.ts`

- [ ] **Step 1: Add native candidate lookup**

Add a function that reads the bot's port from the registry:

```typescript
// Add to resolve-endpoint.ts, after listLocalCandidates:

import { getBot } from "./store.js";

async function listNativeCandidates(name: string): Promise<EndpointCandidate[]> {
  const entry = getBot(name);
  if (!entry || entry.runtime !== "native" || !entry.port) return [];
  return [{
    baseUrl: `http://127.0.0.1:${entry.port}`,
    via: "native-port",
  }];
}
```

- [ ] **Step 2: Integrate into listHostBotEndpointCandidates**

Prepend native candidates (fast — no Docker API call). Don't short-circuit; append Docker candidates too so the probe can sort it out:

```typescript
export async function listHostBotEndpointCandidates(
  name: string,
  opts?: { allowRemote?: boolean },
): Promise<EndpointCandidate[]> {
  // Native candidates first (no Docker API call needed)
  const candidates = await listNativeCandidates(name);

  // Docker candidates (will gracefully return [] if Docker unavailable)
  candidates.push(...await listLocalCandidates(name));

  // ... rest unchanged (remote candidates, dedup)
```

- [ ] **Step 3: Commit**

```bash
git add src/resolve-endpoint.ts
git commit -m "feat: endpoint resolution supports native bots via registry port"
```

---

### Task 8: CLI — Add `--native` Flag

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: Add `--native` flag to spawn command**

```typescript
// In the spawn command definition, add option:
  .option("--native", "Run bot as native process (no Docker)")
```

- [ ] **Step 2: Route spawn through ProcessManager**

Update the spawn action to select runtime:

```typescript
// In spawn action, replace:
//   const containerId = await withSpinner(..., () => docker.spawn(config, botPath));
// With:
    const runtime = opts.native ? "native" : "docker";
    const { getManager } = await import("./process-manager.js");
    const manager = getManager(runtime);
    const id = await withSpinner(`Spawning ${botName(config.name)} (${pc.dim(config.model)})`, () =>
      manager.spawn(config, botPath),
    );
    const label = opts.native ? `PID ${id}` : `container: ${pc.dim(id.slice(0, 12))}`;
    console.log(success(`Bot ${botName(config.name)} is running (${label})`));
```

- [ ] **Step 3: Route start/stop/restart/rm through ProcessManager**

For `start`, `stop`, `restart`, `rm` commands — use `getManagerForBot(name)` to auto-detect runtime:

```typescript
// Example for start:
    const { getManagerForBot } = await import("./process-manager.js");
    const manager = getManagerForBot(name);
    await withSpinner(`Starting ${botName(name)}`, () => manager.start(name));
```

Apply the same pattern to `stop`, `restart`, `rm`.

- [ ] **Step 4: Route logs through ProcessManager**

```typescript
// In logs action:
    const { getManagerForBot } = await import("./process-manager.js");
    const manager = getManagerForBot(name);
    await manager.logs(name, opts.follow ?? false);
```

- [ ] **Step 5: Route ls through listAllBots**

```typescript
// In ls action, replace `docker.list()` with:
    const { listAllBots } = await import("./process-manager.js");
    const bots = await listAllBots();
```

- [ ] **Step 6: Update `--all` variants for stop/restart**

The `stop --all` and `restart --all` code paths also hardcode `docker.list()`/`docker.stop()`/`docker.restart()`. Update them:

```typescript
// In stop --all:
    const { listAllBots, getManagerForBot } = await import("./process-manager.js");
    const bots = await listAllBots();
    const running = bots.filter(b => b.status === "running");
    // ...
    for (const b of running) {
      try { await getManagerForBot(b.name).stop(b.name); ... }
    }

// Same pattern for restart --all
```

- [ ] **Step 7: Add native guard for `exec` command**

```typescript
// In exec action, before calling docker.runInContainer:
    const entry = getBot(name);
    if (entry?.runtime === "native") {
      console.error(`"mecha exec" is not supported for native bots. Run commands directly on the host.`);
      process.exit(1);
    }
```

- [ ] **Step 8: Update init command — Docker no longer mandatory**

```typescript
// In init action, change Docker check from hard fail to warning:
    if (!hasDocker) {
      console.log(pc.yellow("!") + " Docker not found " + pc.dim("(required for Docker runtime, not needed for --native)"));
    }
    // Only build image if Docker is available
    if (hasDocker) {
      await withSpinner("Building Docker image", () => docker.ensureImage());
    }
```

- [ ] **Step 9: Commit**

```bash
git add src/cli.ts
git commit -m "feat: CLI --native flag routes spawn/start/stop/restart/rm through ProcessManager"
```

---

### Task 9: Dashboard Server — Use ProcessManager

**Files:**
- Modify: `src/dashboard-server.ts`

- [ ] **Step 1: Replace `docker.*` calls with ProcessManager calls**

At the top of `startDashboardServer`, import the process manager:

```typescript
import { getManager, getManagerForBot, listAllBots } from "./process-manager.js";
```

Replace all `docker.list()` calls with `listAllBots()`.

Replace `docker.spawn(config, dir)` with `getManager(runtime).spawn(config, dir)` — the spawn body schema needs a `runtime` field (default "docker").

Replace `docker.start/stop/restart/remove` with `getManagerForBot(name).start/stop/restart/remove(name)`.

Key replacements:
- `docker.list()` → `listAllBots()`
- `docker.spawn(config)` → `getManager("docker").spawn(config)` (or `"native"` based on request body)
- `docker.start(name)` → `getManagerForBot(name).start(name)`
- `docker.stop(name)` → `getManagerForBot(name).stop(name)`
- `docker.restart(name)` → `getManagerForBot(name).restart(name)`
- `docker.remove(name)` → `getManagerForBot(name).remove(name)`

- [ ] **Step 2: Add runtime option to spawn body schema**

In `src/dashboard-server-schema.ts`, add `runtime` to `spawnBodySchema`:

```typescript
runtime: z.enum(["docker", "native"]).optional().default("docker"),
```

- [ ] **Step 3: Commit**

```bash
git add src/dashboard-server.ts src/dashboard-server-schema.ts
git commit -m "feat: dashboard server uses ProcessManager for all bot operations"
```

---

### Task 10: Daemon Reconciler — Support Both Runtimes

**Files:**
- Modify: `src/daemon.ts`

- [ ] **Step 1: Update reconcile() to handle native bots**

Replace direct Docker calls with ProcessManager:

```typescript
import { getManagerForBot, listAllBots } from "./process-manager.js";

async function reconcile(): Promise<void> {
  try {
    const bots = listBots();   // registry
    const running = await listAllBots();  // both runtimes
    const runningMap = new Map(running.map(b => [b.name, b]));

    for (const [name, entry] of Object.entries(bots)) {
      const desired = entry.desired_state ?? "running";
      const current = runningMap.get(name);
      const manager = getManagerForBot(name);

      if (desired === "running") {
        if (!current || current.status === "exited") {
          try {
            await manager.start(name);
            auditLog({ actor: "daemon:reconciler", action: "auto-restart", target: name,
              detail: { reason: current ? "process exited" : "process missing", runtime: entry.runtime ?? "docker" }, result: "success" });
          } catch (err) {
            auditLog({ actor: "daemon:reconciler", action: "auto-restart", target: name,
              detail: { error: err instanceof Error ? err.message : String(err) }, result: "failure" });
          }
        }
      } else if (desired === "stopped") {
        if (current && current.status === "running") {
          try {
            await manager.stop(name);
            auditLog({ actor: "daemon:reconciler", action: "auto-stop", target: name,
              detail: { reason: "desired_state=stopped but still running" }, result: "success" });
          } catch (err) {
            auditLog({ actor: "daemon:reconciler", action: "auto-stop", target: name,
              detail: { error: err instanceof Error ? err.message : String(err) }, result: "failure" });
          }
        }
      }
    }
  } catch (err) {
    log.warn("Reconciler error", { error: err instanceof Error ? err.message : String(err) });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/daemon.ts
git commit -m "feat: daemon reconciler supports both Docker and native runtimes"
```

---

### Task 11: MCP Proxy — Use ProcessManager

**Files:**
- Modify: `src/mcp-proxy.ts`

- [ ] **Step 1: Replace docker.list() with listAllBots()**

```typescript
// Replace:
import * as docker from "./docker.js";
// With:
import { listAllBots } from "./process-manager.js";

// Replace docker.list() calls with listAllBots()
```

- [ ] **Step 2: Commit**

```bash
git add src/mcp-proxy.ts
git commit -m "feat: MCP proxy uses ProcessManager for bot discovery"
```

---

### Task 12: Auth Command — Use ProcessManager

**Files:**
- Modify: `src/commands/auth.ts`

- [ ] **Step 1: Replace docker.* with ProcessManager in auth swap**

`mecha auth swap` calls `docker.stop()`, `docker.remove()`, `docker.spawn()` directly. Replace with:

```typescript
import { getManagerForBot } from "../process-manager.js";

// In auth swap action:
const manager = getManagerForBot(name);
await manager.restart(name);  // simpler than stop+remove+spawn
```

- [ ] **Step 2: Commit**

```bash
git add src/commands/auth.ts
git commit -m "feat: auth swap uses ProcessManager for runtime-agnostic bot restart"
```

---

### Task 13: CLI Utils — Remove Docker Dependency

**Files:**
- Modify: `src/cli-utils.ts`

- [ ] **Step 1: Update BotInfo import**

Change `import type { BotInfo } from "./docker.types.js"` to `import type { BotInfo } from "./process-manager.js"`.

If `cli-utils.ts` uses `dockerode` directly (line 117), check if it's for `fetchRemoteBots` or similar — guard behind Docker availability or make conditional.

- [ ] **Step 2: Commit**

```bash
git add src/cli-utils.ts
git commit -m "refactor: cli-utils imports BotInfo from process-manager"
```

---

### Task 14: Doctor — Handle Native Runtime

**Files:**
- Modify: `src/doctor.ts`

- [ ] **Step 1: Add native health checks**

In `doctorBot`, check if bot is native and verify PID instead of Docker container:

```typescript
// If entry.runtime === "native":
//   Check PID file exists and process is alive
//   Probe health endpoint at registered port
// If entry.runtime === "docker" (or undefined):
//   Existing Docker container checks
```

In `doctorMecha`, make Docker check a warning instead of a failure when native bots exist.

- [ ] **Step 2: Commit**

```bash
git add src/doctor.ts
git commit -m "feat: doctor command supports native runtime diagnosis"
```

---

### Task 15: Integration Test — Spawn Native Bot

**Files:**
- Test manually (or add to existing test suite)

- [ ] **Step 1: Verify native spawn end-to-end**

```bash
# Build the project
npm run build

# Spawn a native bot
mecha spawn --name test-native --system "You are a test bot" --native

# Check it's running
mecha ls

# Query it
mecha query test-native "hello"

# Check logs
mecha logs test-native

# Stop and remove
mecha stop test-native
mecha rm test-native
```

- [ ] **Step 2: Verify Docker bots still work (no regression)**

```bash
mecha spawn --name test-docker --system "You are a test bot"
mecha ls                # should show both runtime types
mecha query test-docker "hello"
mecha rm -f test-docker
```

- [ ] **Step 3: Verify mixed fleet in dashboard**

```bash
mecha dashboard
# Both native and Docker bots should appear in the fleet dashboard
```

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: integration test fixes for native runtime"
```

---

## Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| Port conflicts | `pickPort()` does actual port binding probe (not just registry scan) to avoid TOCTOU races |
| Orphan processes | Daemon reconciler checks PID liveness; `agent.pid` files provide recovery |
| No filesystem isolation | Native mode shares host user — acceptable tradeoff, documented |
| node-pty may not be available | Agent already handles this gracefully (PTY optional) |
| Dashboard dist not found | `MECHA_DASHBOARD_ROOT` env var resolves to installed package path |

## Out of Scope

- Per-bot user/group isolation (would need sudo/systemd, overkill for v1)
- Global `mecha.json` default runtime setting (can add later, trivial)
- `mecha exec` for native bots (not meaningful without container — users just run commands directly)
- Tailscale per-bot networking in native mode (uses host Tailscale)
