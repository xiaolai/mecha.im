/**
 * Mecha singleton daemon — manages fleet lifecycle with reconciliation loop.
 *
 * Lock: $MECHA_DIR/.daemon.lock (directory-based, same as registry lock)
 * State: $MECHA_DIR/daemon.json (port, pid, startedAt, version, status)
 * Logs: $MECHA_DIR/logs/daemon.log
 */

import { mkdirSync, rmdirSync, readFileSync, writeFileSync, statSync, unlinkSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { spawn as spawnChild } from "node:child_process";
import { fileURLToPath } from "node:url";
import { getMechaDir, listBots } from "./store.js";
import { auditLog } from "./daemon-audit.js";
import * as docker from "./docker.js";
import { log } from "../shared/logger.js";

const LOCK_STALE_MS = 30_000;
const RECONCILE_INTERVAL_MS = 30_000;
const SHUTDOWN_DRAIN_MS = 5_000;

interface DaemonState {
  pid: number;
  port: number;
  host: string;
  startedAt: string;
  version: string;
  status: "starting" | "ready" | "stopping";
}

function lockDir(): string { return join(getMechaDir(), ".daemon.lock"); }
function stateFile(): string { return join(getMechaDir(), "daemon.json"); }

function readVersion(): string {
  try {
    const pkgPath = join(fileURLToPath(import.meta.url), "..", "..", "package.json");
    return JSON.parse(readFileSync(pkgPath, "utf-8")).version ?? "unknown";
  } catch { return "unknown"; }
}

// ── Lock ────────────────────────────────────────────────────

function acquireLock(): boolean {
  try {
    mkdirSync(lockDir());
    return true;
  } catch {
    // Check for stale lock
    try {
      const mtime = statSync(lockDir()).mtimeMs;
      if (Date.now() - mtime > LOCK_STALE_MS) {
        try { rmdirSync(lockDir()); } catch { return false; }
        try { mkdirSync(lockDir()); return true; } catch { return false; }
      }
    } catch { /* can't stat — lock doesn't exist or was removed */ }
    return false;
  }
}

function releaseLock(): void {
  try { rmdirSync(lockDir()); } catch { /* ignore */ }
}

// ── State file ──────────────────────────────────────────────

function writeState(state: DaemonState): void {
  writeFileSync(stateFile(), JSON.stringify(state, null, 2));
}

function readState(): DaemonState | null {
  try {
    return JSON.parse(readFileSync(stateFile(), "utf-8"));
  } catch { return null; }
}

function removeState(): void {
  try { unlinkSync(stateFile()); } catch { /* ok */ }
}

// ── Reconciler ──────────────────────────────────────────────

async function reconcile(): Promise<void> {
  try {
    const bots = listBots();
    const containers = await docker.list();
    const containerMap = new Map(containers.map(c => [c.name, c]));

    for (const [name, entry] of Object.entries(bots)) {
      const desired = entry.desired_state ?? "running"; // default: running for backward compat
      const container = containerMap.get(name);

      if (desired === "running") {
        if (!container || container.status === "exited") {
          // Bot should be running but isn't — auto-restart
          try {
            await docker.start(name);
            auditLog({ actor: "daemon:reconciler", action: "auto-restart", target: name,
              detail: { reason: container ? "container exited" : "container missing" }, result: "success" });
          } catch (err) {
            auditLog({ actor: "daemon:reconciler", action: "auto-restart", target: name,
              detail: { error: err instanceof Error ? err.message : String(err) }, result: "failure" });
          }
        }
      } else if (desired === "stopped") {
        if (container && container.status === "running") {
          // Drift: running but should be stopped — stop it
          try {
            await docker.stop(name);
            auditLog({ actor: "daemon:reconciler", action: "auto-stop", target: name,
              detail: { reason: "desired_state=stopped but container running" }, result: "success" });
          } catch (err) {
            auditLog({ actor: "daemon:reconciler", action: "auto-stop", target: name,
              detail: { error: err instanceof Error ? err.message : String(err) }, result: "failure" });
          }
        }
      }
    }

    // Check for orphan containers
    for (const container of containers) {
      if (!bots[container.name]) {
        auditLog({ actor: "daemon:reconciler", action: "orphan-detected", target: container.name,
          detail: { containerId: container.containerId }, result: "skipped" });
      }
    }
  } catch (err) {
    log.warn("Reconciler error", { error: err instanceof Error ? err.message : String(err) });
  }
}

// ── Daemon start/stop ───────────────────────────────────────

let reconcileTimer: ReturnType<typeof setInterval> | null = null;
let shuttingDown = false;

export async function startDaemon(port: number, host: string, foreground: boolean): Promise<void> {
  mkdirSync(join(getMechaDir(), "logs"), { recursive: true });

  if (!acquireLock()) {
    const state = readState();
    if (state) {
      console.log(`Daemon already running on http://${host === "0.0.0.0" ? "localhost" : host}:${state.port} (PID ${state.pid})`);
    } else {
      console.error("Another daemon instance is running (lock held). Use 'mecha daemon stop' first.");
    }
    process.exit(1);
  }

  // Write initial state
  writeState({
    pid: process.pid,
    port,
    host,
    startedAt: new Date().toISOString(),
    version: readVersion(),
    status: "starting",
  });

  // Start HTTP server
  const { startDashboardServer } = await import("./dashboard-server.js");
  startDashboardServer(port, host);

  // Update state to ready
  writeState({
    pid: process.pid,
    port,
    host,
    startedAt: new Date().toISOString(),
    version: readVersion(),
    status: "ready",
  });

  // Start reconciler
  reconcileTimer = setInterval(reconcile, RECONCILE_INTERVAL_MS);

  // Refresh lock mtime to prevent stale detection by other processes
  const lockRefreshTimer = setInterval(() => {
    try {
      const now = new Date();
      utimesSync(lockDir(), now, now);
    } catch { /* lock dir may be gone during shutdown */ }
  }, LOCK_STALE_MS / 3); // refresh at 1/3 of stale threshold

  auditLog({ actor: "daemon:lifecycle", action: "started", detail: { port, host, pid: process.pid }, result: "success" });
  console.log(`Daemon running on http://${host === "0.0.0.0" ? "localhost" : host}:${port} (PID ${process.pid})`);

  // Signal handling
  let sigCount = 0;
  const shutdown = async () => {
    sigCount++;
    if (sigCount > 1) {
      console.log("Force shutdown");
      process.exit(1);
    }
    if (shuttingDown) return;
    shuttingDown = true;

    console.log("Shutting down daemon...");
    writeState({ ...readState()!, status: "stopping" });

    if (reconcileTimer) { clearInterval(reconcileTimer); reconcileTimer = null; }
    clearInterval(lockRefreshTimer);

    // Give SSE connections time to close
    await new Promise(r => setTimeout(r, SHUTDOWN_DRAIN_MS));

    auditLog({ actor: "daemon:lifecycle", action: "stopped", result: "success" });
    removeState();
    releaseLock();
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  if (!foreground) {
    // Background mode: detach from terminal
    process.stdin.unref?.();
  }
}

export async function stopDaemon(): Promise<boolean> {
  const state = readState();
  if (!state || state.status === "stopping") {
    console.log("Daemon is not running.");
    return false;
  }

  // Verify the process is alive AND matches our start time (prevents PID reuse)
  try {
    process.kill(state.pid, 0);
    // Extra check: verify the daemon.json still has matching startedAt
    const freshState = readState();
    if (!freshState || freshState.startedAt !== state.startedAt) {
      console.log("Daemon state is stale — cleaning up.");
      removeState();
      releaseLock();
      return true;
    }
  } catch {
    console.log("Daemon process not found — cleaning up stale state.");
    removeState();
    releaseLock();
    return true;
  }

  // Send SIGTERM
  try {
    process.kill(state.pid, "SIGTERM");
    console.log(`Sent SIGTERM to daemon (PID ${state.pid})`);
  } catch {
    removeState();
    releaseLock();
    return true;
  }

  // Wait for shutdown (max 10s)
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 500));
    try { process.kill(state.pid, 0); } catch { break; } // process gone
  }

  // Verify cleanup
  try { process.kill(state.pid, 0); } catch {
    console.log("Daemon stopped.");
    return true;
  }

  // Force kill
  console.log("Daemon did not stop gracefully — sending SIGKILL");
  try { process.kill(state.pid, "SIGKILL"); } catch { /* already gone */ }
  removeState();
  releaseLock();
  return true;
}

export function getDaemonStatus(): { running: boolean; state: DaemonState | null } {
  const state = readState();
  if (!state) return { running: false, state: null };
  // Verify process is alive
  try {
    process.kill(state.pid, 0);
    return { running: true, state };
  } catch {
    return { running: false, state };
  }
}

export function getDaemonUrl(): string | null {
  // 1. Env var override
  if (process.env.MECHA_URL) return process.env.MECHA_URL;
  // 2. Read state file
  const state = readState();
  if (state && state.status === "ready") {
    const h = (state.host === "0.0.0.0") ? "localhost" : state.host;
    try { process.kill(state.pid, 0); return `http://${h}:${state.port}`; } catch { /* stale */ }
  }
  return null;
}

export async function ensureDaemon(): Promise<string> {
  const url = getDaemonUrl();
  if (url) {
    // Verify alive
    try {
      const r = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(2000) });
      if (r.ok) return url;
    } catch { /* stale */ }
  }

  // Auto-start in background
  const cliPath = join(fileURLToPath(import.meta.url), "..", "cli.js");
  const child = spawnChild(process.execPath, [cliPath, "daemon", "start", "--background"], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env },
  });
  child.unref();

  // Wait for daemon to become ready (max 10s)
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 500));
    const state = readState();
    if (state?.status === "ready") {
      return `http://localhost:${state.port}`;
    }
  }

  throw new Error("Failed to auto-start daemon. Run 'mecha daemon start' manually.");
}
