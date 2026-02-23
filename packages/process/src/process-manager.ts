import { spawn as cpSpawn, type ChildProcess } from "node:child_process";
import { createReadStream, mkdirSync, openSync, existsSync, readFileSync as fsReadFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { DEFAULTS } from "@mecha/core";
import type { MechaState } from "@mecha/core";
import { StateStore, isPidAlive } from "./state-store.js";
import { allocatePort } from "./port-manager.js";
import { EventLog } from "./events.js";
import type { ProcessManager, SpawnOpts, MechaProcessInfo, ProcessEvent, LogStreamOpts } from "./types.js";

const STOP_TIMEOUT_MS = 10_000;
const HEALTHZ_POLL_MS = 200;
const HEALTHZ_TIMEOUT_MS = 15_000;

export interface ProcessManagerOpts {
  /** Base directory for mecha data (default: ~/.mecha). */
  mechaHome?: string;
  /** Path to the runtime entry point (default: resolved from @mecha/runtime). */
  runtimeEntry?: string;
  /** Port range base (default: DEFAULTS.PORT_BASE). */
  portBase?: number;
  /** Port range max (default: DEFAULTS.PORT_MAX). */
  portMax?: number;
}

/**
 * Create a ProcessManager that spawns @mecha/runtime as child processes.
 */
export function createProcessManager(opts?: ProcessManagerOpts): ProcessManager {
  /* v8 ignore start -- HOME always set in practice */
  const home = opts?.mechaHome ?? join(process.env["HOME"] ?? "/tmp", DEFAULTS.HOME_DIR);
  /* v8 ignore stop */
  const stateDir = join(home, "processes");
  const logDir = join(home, "logs");
  const eventsFile = join(home, "events.jsonl");
  const portBase = opts?.portBase ?? DEFAULTS.PORT_BASE;
  const portMax = opts?.portMax ?? DEFAULTS.PORT_MAX;

  mkdirSync(stateDir, { recursive: true });
  mkdirSync(logDir, { recursive: true });

  const store = new StateStore(stateDir);
  const eventLog = new EventLog(eventsFile);

  // Track live child processes for stop/kill
  const liveProcesses = new Map<string, ChildProcess>();

  /* v8 ignore start — runtime resolution uses require.resolve which varies by environment */
  function resolveRuntimeEntry(): string {
    if (opts?.runtimeEntry) return opts.runtimeEntry;
    try {
      return require.resolve("@mecha/runtime/dist/index.js");
    } catch {
      return join(process.cwd(), "node_modules", "@mecha", "runtime", "dist", "index.js");
    }
  }
  /* v8 ignore stop */

  async function spawn(spawnOpts: SpawnOpts): Promise<MechaProcessInfo> {
    const { mechaId, projectPath, authToken, env: extraEnv = {}, permissionMode } = spawnOpts;

    // Allocate port
    const liveInfos = listLive();
    const port = await allocatePort(portBase, portMax, liveInfos, spawnOpts.port);

    // Build environment
    const processEnv: Record<string, string> = {
      ...extraEnv,
      MECHA_ID: mechaId,
      PORT: String(port),
      HOST: "127.0.0.1",
      MECHA_AUTH_TOKEN: authToken,
      MECHA_WORKSPACE: projectPath,
      MECHA_DB_PATH: join(projectPath, ".mecha", "state.db"),
      HOME: spawnOpts.claudeConfigDir,
    };
    if (permissionMode) {
      processEnv["MECHA_PERMISSION_MODE"] = permissionMode;
    }
    // Preserve PATH and NODE env from parent
    /* v8 ignore start — env vars always present in test environments */
    if (process.env["PATH"]) processEnv["PATH"] = process.env["PATH"];
    if (process.env["NODE_OPTIONS"]) processEnv["NODE_OPTIONS"] = process.env["NODE_OPTIONS"];
    /* v8 ignore stop */

    // Ensure project .mecha dir exists
    mkdirSync(join(projectPath, ".mecha"), { recursive: true });

    // Open log file
    const logPath = join(logDir, `${mechaId}.log`);
    const logFd = openSync(logPath, "a");

    const runtimeEntry = resolveRuntimeEntry();

    const child = cpSpawn("node", [runtimeEntry], {
      cwd: projectPath,
      env: processEnv,
      stdio: ["ignore", logFd, logFd],
      detached: true,
    });

    child.unref();

    const pid = child.pid!;
    const now = new Date().toISOString();
    const startFingerprint = `${pid}:${Date.now()}`;

    const info: MechaProcessInfo = {
      id: mechaId,
      pid,
      port,
      projectPath,
      state: "running",
      authToken,
      env: processEnv,
      createdAt: now,
      startedAt: now,
      startFingerprint,
    };

    store.save(info);
    liveProcesses.set(mechaId, child);

    // Listen for exit
    /* v8 ignore start — child process event handlers fire asynchronously after test teardown */
    child.on("exit", (code) => {
      liveProcesses.delete(mechaId);
      const saved = store.load(mechaId);
      if (saved && saved.startFingerprint === startFingerprint) {
        saved.state = "stopped";
        store.save(saved);
      }
      eventLog.emit({ type: "exit", mechaId, pid, exitCode: code ?? undefined, timestamp: Date.now() });
    });

    child.on("error", () => {
      liveProcesses.delete(mechaId);
      const saved = store.load(mechaId);
      if (saved && saved.startFingerprint === startFingerprint) {
        saved.state = "error";
        store.save(saved);
      }
      eventLog.emit({ type: "error", mechaId, pid, timestamp: Date.now() });
    /* v8 ignore stop */
    });

    // Wait for healthz
    await waitForHealthz(port, pid);

    eventLog.emit({ type: "start", mechaId, pid, timestamp: Date.now() });
    return info;
  }

  async function stop(id: string): Promise<void> {
    const info = store.load(id);
    if (!info) throw new Error(`Mecha not found: ${id}`);

    if (!isPidAlive(info.pid)) {
      info.state = "stopped";
      store.save(info);
      return;
    }

    // Try graceful SIGTERM
    try {
      process.kill(info.pid, "SIGTERM");
    } catch {
      // Process already gone
      info.state = "stopped";
      store.save(info);
      return;
    }

    // Wait up to STOP_TIMEOUT_MS for process to exit
    const deadline = Date.now() + STOP_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (!isPidAlive(info.pid)) {
        info.state = "stopped";
        store.save(info);
        eventLog.emit({ type: "stop", mechaId: id, pid: info.pid, timestamp: Date.now() });
        return;
      }
      await sleep(200);
    }

    // Force SIGKILL
    try {
      process.kill(info.pid, "SIGKILL");
    } catch {
      // Already gone
    }
    info.state = "stopped";
    store.save(info);
    eventLog.emit({ type: "stop", mechaId: id, pid: info.pid, timestamp: Date.now() });
  }

  async function kill(id: string, force?: boolean): Promise<void> {
    const info = store.load(id);
    if (info && isPidAlive(info.pid)) {
      try {
        process.kill(info.pid, force ? "SIGKILL" : "SIGTERM");
      } catch {
        // ignore
      }
      // Brief wait for cleanup
      if (!force) {
        const deadline = Date.now() + STOP_TIMEOUT_MS;
        while (Date.now() < deadline && isPidAlive(info.pid)) {
          await sleep(200);
        }
        if (isPidAlive(info.pid)) {
          try { process.kill(info.pid, "SIGKILL"); } catch { /* ignore */ }
        }
      }
    }
    liveProcesses.delete(id);
    store.remove(id);
  }

  function get(id: string): MechaProcessInfo | undefined {
    const info = store.load(id);
    if (!info) return undefined;
    // Verify PID is still alive
    if (info.state === "running" && !isPidAlive(info.pid)) {
      info.state = "stopped";
      store.save(info);
    }
    return info;
  }

  function listLive(): MechaProcessInfo[] {
    return store.listAll().map((info) => {
      if (info.state === "running" && !isPidAlive(info.pid)) {
        info.state = "stopped";
        store.save(info);
      }
      return info;
    });
  }

  function list(): MechaProcessInfo[] {
    return listLive();
  }

  function logs(id: string, logOpts?: LogStreamOpts): NodeJS.ReadableStream {
    const logPath = join(logDir, `${id}.log`);
    if (!existsSync(logPath)) {
      const empty = new Readable({ read() { this.push(null); } });
      return empty;
    }

    if (logOpts?.follow) {
      return createFollowStream(logPath, logOpts.tail);
    }

    // Read last N lines
    const content = fsReadFileSync(logPath, "utf-8");
    const lines = content.split("\n");
    const tail = logOpts?.tail ?? 100;
    const selected = lines.slice(-tail - 1).join("\n");
    const stream = new Readable({ read() { this.push(selected); this.push(null); } });
    return stream;
  }

  function getPortAndEnv(id: string): { port: number | undefined; env: Record<string, string> } {
    const info = store.load(id);
    if (!info) return { port: undefined, env: {} };
    return { port: info.port, env: info.env };
  }

  function onEvent(handler: (event: ProcessEvent) => void): () => void {
    return eventLog.watch(handler);
  }

  return { spawn, stop, kill, get, list, logs, getPortAndEnv, onEvent };
}

/** Poll the runtime's /healthz until it responds or timeout. */
async function waitForHealthz(port: number, pid: number): Promise<void> {
  const deadline = Date.now() + HEALTHZ_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) {
      throw new Error(`Runtime process (PID ${pid}) exited before becoming healthy`);
    }
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), HEALTHZ_POLL_MS);
      const res = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: controller.signal });
      clearTimeout(timer);
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await sleep(HEALTHZ_POLL_MS);
  }
  throw new Error(`Runtime process (PID ${pid}) did not become healthy within ${HEALTHZ_TIMEOUT_MS}ms`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* v8 ignore start — fs.watchFile-based follow stream is timing-dependent */
function createFollowStream(logPath: string, tail?: number): NodeJS.ReadableStream {
  const { readFileSync, watchFile, unwatchFile } = require("node:fs") as typeof import("node:fs");

  let lastSize = 0;
  const stream = new Readable({
    read() {
      if (lastSize === 0) {
        const content = readFileSync(logPath, "utf-8");
        lastSize = content.length;
        if (tail !== undefined) {
          const lines = content.split("\n");
          const selected = lines.slice(-tail - 1).join("\n");
          this.push(selected);
        } else {
          this.push(content);
        }
      }
    },
    destroy(err, callback) {
      unwatchFile(logPath);
      callback(err);
    },
  });

  watchFile(logPath, { interval: 500 }, () => {
    try {
      const content = readFileSync(logPath, "utf-8");
      if (content.length > lastSize) {
        const newContent = content.substring(lastSize);
        lastSize = content.length;
        stream.push(newContent);
      }
    } catch {
      // file may be temporarily unavailable
    }
  });

  return stream;
}
/* v8 ignore stop */
