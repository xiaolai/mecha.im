import { spawn as cpSpawn } from "node:child_process";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { writeFileSync, renameSync } from "node:fs";
import {
  type CasaName,
  type DiscoveryIndex,
  type DiscoveryIndexEntry,
  DEFAULTS,
  isValidName,
  InvalidNameError,
  CasaNotFoundError,
  CasaNotRunningError,
  readCasaConfig,
} from "@mecha/core";
import { readState, writeState, listCasaDirs } from "./state-store.js";
import { ProcessEventEmitter } from "./events.js";
import type { ProcessEvent } from "./events.js";
import { isPidAlive, waitForChildExit, waitForPidExit } from "./process-lifecycle.js";

/** Send a signal, ignoring ESRCH (process already gone). */
function safePidKill(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal);
  } catch (err) {
    /* v8 ignore start -- only ESRCH expected; re-throw is a safety net */
    if ((err as NodeJS.ErrnoException).code !== "ESRCH") throw err;
    /* v8 ignore stop */
  }
}
import { spawnCasa, type SpawnContext } from "./spawn-pipeline.js";
import { readLogs } from "./log-reader.js";
import type {
  SpawnOpts,
  ProcessInfo,
  LogOpts,
  ProcessManager,
  LiveProcess,
  CreateProcessManagerOpts,
} from "./types.js";
import type { Readable } from "node:stream";

export type { SpawnOpts, ProcessInfo, LogOpts, ProcessManager, CreateProcessManagerOpts };

export function createProcessManager(opts: CreateProcessManagerOpts): ProcessManager {
  const { mechaDir, healthTimeoutMs = DEFAULTS.HEALTH_TIMEOUT_MS } = opts;
  const emitter = new ProcessEventEmitter();
  const live = new Map<string, LiveProcess>();

  function _casaDir(name: string): string {
    if (!isValidName(name)) throw new InvalidNameError(name);
    return join(mechaDir, name);
  }

  function _updateDiscoveryIndex(): void {
    try {
      const casas: DiscoveryIndexEntry[] = [];
      for (const dir of listCasaDirs(mechaDir)) {
        const st = readState(dir);
        /* v8 ignore start -- defensive: state always exists for listCasaDirs results */
        if (!st) continue;
        /* v8 ignore stop */
        const config = readCasaConfig(dir);
        /* v8 ignore start -- defensive: config shape validation for tags/expose */
        const tags = Array.isArray(config?.tags) ? config.tags.filter((t): t is string => typeof t === "string") : [];
        const expose = Array.isArray(config?.expose) ? config.expose.filter((e): e is string => typeof e === "string") : [];
        /* v8 ignore stop */
        casas.push({ name: st.name, tags, expose, state: st.state });
      }
      const index: DiscoveryIndex = { version: 1, updatedAt: new Date().toISOString(), casas };
      const indexPath = join(mechaDir, "discovery.json");
      const tmp = indexPath + `.${randomBytes(4).toString("hex")}.tmp`;
      writeFileSync(tmp, JSON.stringify(index, null, 2) + "\n", { mode: 0o600 });
      renameSync(tmp, indexPath);
    /* v8 ignore start -- defensive: discovery index write failure should not crash lifecycle */
    } catch (err) {
      emitter.emit({ type: "warning", name: "" as CasaName, message: `Failed to update discovery index: ${err instanceof Error ? err.message : String(err)}` });
    }
    /* v8 ignore stop */
  }

  // On init, scan for existing state and check PID liveness
  _recoverState();

  function _recoverState(): void {
    let changed = false;
    for (const casaDir of listCasaDirs(mechaDir)) {
      const state = readState(casaDir);
      if (!state) continue;
      if (state.state === "running" && state.pid) {
        if (!isPidAlive(state.pid)) {
          state.state = "stopped";
          state.stoppedAt = new Date().toISOString();
          writeState(casaDir, state);
          changed = true;
        }
      }
    }
    if (changed) _updateDiscoveryIndex();
  }

  const spawnCtx: SpawnContext = {
    opts,
    mechaDir,
    healthTimeoutMs,
    sandbox: opts.sandbox,
    spawnFn: opts.spawnFn ?? cpSpawn,
    emitter,
    live,
    casaDir: _casaDir,
    onStateChange: _updateDiscoveryIndex,
  };

  async function spawn(spawnOpts: SpawnOpts): Promise<ProcessInfo> {
    const result = await spawnCasa(spawnCtx, spawnOpts);
    _updateDiscoveryIndex();
    return result;
  }

  function getCasa(name: CasaName): ProcessInfo | undefined {
    const casaDir = _casaDir(name);
    const state = readState(casaDir);
    if (!state) return undefined;

    const lp = live.get(name);

    if (!lp && state.state === "running" && state.pid && !isPidAlive(state.pid)) {
      state.state = "stopped";
      state.stoppedAt = new Date().toISOString();
      writeState(casaDir, state);
      _updateDiscoveryIndex();
    }

    return {
      name: state.name as CasaName,
      state: state.state,
      pid: state.pid,
      port: state.port,
      workspacePath: state.workspacePath,
      token: lp?.token,
      startedAt: state.startedAt,
      stoppedAt: state.stoppedAt,
      exitCode: state.exitCode,
    };
  }

  function listCasas(): ProcessInfo[] {
    const results: ProcessInfo[] = [];
    let livenessChanged = false;
    for (const casaDir of listCasaDirs(mechaDir)) {
      const state = readState(casaDir);
      if (!state) continue;
      const lp = live.get(state.name);
      if (!lp && state.state === "running" && state.pid && !isPidAlive(state.pid)) {
        state.state = "stopped";
        state.stoppedAt = new Date().toISOString();
        writeState(casaDir, state);
        livenessChanged = true;
      }
      results.push({
        name: state.name as CasaName,
        state: state.state,
        pid: state.pid,
        port: state.port,
        workspacePath: state.workspacePath,
        token: lp?.token,
        startedAt: state.startedAt,
        stoppedAt: state.stoppedAt,
        exitCode: state.exitCode,
      });
    }
    if (livenessChanged) _updateDiscoveryIndex();
    return results;
  }

  async function stopCasa(name: CasaName): Promise<void> {
    const lp = live.get(name);
    if (!lp) {
      const state = readState(_casaDir(name));
      if (!state) throw new CasaNotFoundError(name);
      if (state.state !== "running") throw new CasaNotRunningError(name);
      if (state.pid && isPidAlive(state.pid)) {
        safePidKill(state.pid, "SIGTERM");
        await waitForPidExit(state.pid, DEFAULTS.STOP_GRACE_MS);
        if (isPidAlive(state.pid)) {
          safePidKill(state.pid, "SIGKILL");
        }
      }
      state.state = "stopped";
      state.stoppedAt = new Date().toISOString();
      writeState(_casaDir(name), state);
      _updateDiscoveryIndex();
      emitter.emit({ type: "stopped", name });
      return;
    }

    try { lp.child.kill("SIGTERM"); } catch { /* child already gone */ }
    const exited = await waitForChildExit(lp.child, DEFAULTS.STOP_GRACE_MS);
    if (!exited) {
      try { lp.child.kill("SIGKILL"); } catch { /* child already gone */ }
      await waitForChildExit(lp.child, 2000);
    }
  }

  async function killCasa(name: CasaName): Promise<void> {
    const lp = live.get(name);
    if (!lp) {
      const state = readState(_casaDir(name));
      if (!state) throw new CasaNotFoundError(name);
      if (state.pid && isPidAlive(state.pid)) {
        safePidKill(state.pid, "SIGKILL");
      }
      state.state = "stopped";
      state.stoppedAt = new Date().toISOString();
      writeState(_casaDir(name), state);
      _updateDiscoveryIndex();
      emitter.emit({ type: "stopped", name });
      return;
    }

    try { lp.child.kill("SIGKILL"); } catch { /* child already gone */ }
    await waitForChildExit(lp.child, DEFAULTS.STOP_GRACE_MS);
  }

  function getLogs(name: CasaName, logOpts?: LogOpts): Readable {
    return readLogs(_casaDir(name), name, logOpts);
  }

  function getPortAndToken(name: CasaName): { port: number; token: string } | undefined {
    const lp = live.get(name);
    if (lp) return { port: lp.port, token: lp.token };

    const casaDir = _casaDir(name);
    const state = readState(casaDir);
    if (state?.state === "running" && state.pid && isPidAlive(state.pid)) {
      const config = readCasaConfig(casaDir);
      if (config) return { port: config.port, token: config.token };
    }
    return undefined;
  }

  function onEvent(handler: (event: ProcessEvent) => void): () => void {
    return emitter.subscribe(handler);
  }

  return {
    spawn,
    get: getCasa,
    list: listCasas,
    stop: stopCasa,
    kill: killCasa,
    logs: getLogs,
    getPortAndToken,
    onEvent,
  };
}
