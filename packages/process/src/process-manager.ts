import { spawn as cpSpawn } from "node:child_process";
import { join } from "node:path";
import {
  type BotName,
  DEFAULTS,
  isValidName,
  InvalidNameError,
  BotNotFoundError,
  BotNotRunningError,
  readBotConfig,
} from "@mecha/core";
import { readState, writeState, listBotDirs } from "./state-store.js";
import { ProcessEventEmitter } from "./events.js";
import type { ProcessEvent } from "./events.js";
import { isPidAlive, waitForChildExit, waitForPidExit } from "./process-lifecycle.js";
import { updateDiscoveryIndex, recoverState } from "./discovery-index.js";

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
import { spawnBot, type SpawnContext } from "./spawn-pipeline.js";
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

  // Per-bot mutex to serialize lifecycle operations (spawn/stop/kill)
  const botLocks = new Map<string, Promise<void>>();
  async function withBotLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const prev = botLocks.get(name) ?? Promise.resolve();
    let resolve: () => void;
    const next = new Promise<void>((r) => { resolve = r; });
    botLocks.set(name, next);
    await prev;
    try {
      return await fn();
    } finally {
      resolve!();
      /* v8 ignore start -- concurrent lock cleanup: only last enqueued lock deletes entry */
      if (botLocks.get(name) === next) botLocks.delete(name);
      /* v8 ignore stop */
    }
  }

  function _botDir(name: string): string {
    if (!isValidName(name)) throw new InvalidNameError(name);
    return join(mechaDir, name);
  }

  function _updateDiscoveryIndex(): void {
    updateDiscoveryIndex(mechaDir, emitter);
  }

  // On init, scan for existing state and check PID liveness
  recoverState(mechaDir, emitter);

  const spawnCtx: SpawnContext = {
    opts,
    mechaDir,
    healthTimeoutMs,
    sandbox: opts.sandbox,
    spawnFn: opts.spawnFn ?? cpSpawn,
    emitter,
    live,
    botDir: _botDir,
    onStateChange: _updateDiscoveryIndex,
  };

  async function spawn(spawnOpts: SpawnOpts): Promise<ProcessInfo> {
    return withBotLock(spawnOpts.name, async () => {
      const result = await spawnBot(spawnCtx, spawnOpts);
      _updateDiscoveryIndex();
      return result;
    });
  }

  function getBot(name: BotName): ProcessInfo | undefined {
    const botDir = _botDir(name);
    const state = readState(botDir);
    if (!state) return undefined;

    const lp = live.get(name);

    if (!lp && state.state === "running" && state.pid && !isPidAlive(state.pid)) {
      // Dead PID found — mark as "error" (unexpected death), not "stopped" (clean exit)
      state.state = "error";
      state.stoppedAt = new Date().toISOString();
      writeState(botDir, state);
      _updateDiscoveryIndex();
    }

    return {
      name: state.name as BotName,
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

  function listBots(): ProcessInfo[] {
    const results: ProcessInfo[] = [];
    let livenessChanged = false;
    for (const botDir of listBotDirs(mechaDir)) {
      const state = readState(botDir);
      if (!state) continue;
      const lp = live.get(state.name);
      if (!lp && state.state === "running" && state.pid && !isPidAlive(state.pid)) {
        // Dead PID found — mark as "error" (unexpected death), not "stopped" (clean exit)
        state.state = "error";
        state.stoppedAt = new Date().toISOString();
        writeState(botDir, state);
        livenessChanged = true;
      }
      results.push({
        name: state.name as BotName,
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

  async function stopBot(name: BotName): Promise<void> {
    return withBotLock(name, async () => {
    const lp = live.get(name);
    if (!lp) {
      const state = readState(_botDir(name));
      if (!state) throw new BotNotFoundError(name);
      if (state.state !== "running") throw new BotNotRunningError(name);
      if (state.pid && isPidAlive(state.pid)) {
        safePidKill(state.pid, "SIGTERM");
        await waitForPidExit(state.pid, DEFAULTS.STOP_GRACE_MS);
        if (isPidAlive(state.pid)) {
          safePidKill(state.pid, "SIGKILL");
          /* v8 ignore start -- SIGKILL verification: process surviving SIGKILL is OS-level edge case */
          await waitForPidExit(state.pid, 5_000);
          if (isPidAlive(state.pid)) {
            state.state = "error";
            writeState(_botDir(name), state);
            _updateDiscoveryIndex();
            emitter.emit({ type: "warning", name, message: `Process ${state.pid} did not exit after SIGKILL` });
            return;
          }
          /* v8 ignore stop */
        }
      }
      state.state = "stopped";
      state.stoppedAt = new Date().toISOString();
      writeState(_botDir(name), state);
      _updateDiscoveryIndex();
      emitter.emit({ type: "stopped", name });
      return;
    }

    try { lp.child.kill("SIGTERM"); } catch (err) {
      /* v8 ignore start -- only ESRCH expected */
      if ((err as NodeJS.ErrnoException).code !== "ESRCH") throw err;
      /* v8 ignore stop */
    }
    const exited = await waitForChildExit(lp.child, DEFAULTS.STOP_GRACE_MS);
    if (!exited) {
      try { lp.child.kill("SIGKILL"); } catch (err) {
        /* v8 ignore start -- only ESRCH expected */
        if ((err as NodeJS.ErrnoException).code !== "ESRCH") throw err;
        /* v8 ignore stop */
      }
      await waitForChildExit(lp.child, 2000);
    }

    // Defensive: ensure live map is cleaned up even if the "exit" event handler
    // hasn't fired yet (e.g. SIGKILL timeout, event loop stall). Without this,
    // a subsequent spawn() would throw BotAlreadyExistsError.
    /* v8 ignore start -- defensive cleanup for SIGKILL-surviving edge case */
    if (live.has(name)) {
      const pid = lp.child.pid;
      const stillAlive = pid != null && isPidAlive(pid);
      live.delete(name);
      const state = readState(_botDir(name));
      if (state && state.state === "running") {
        state.state = stillAlive ? "error" : "stopped";
        state.stoppedAt = new Date().toISOString();
        writeState(_botDir(name), state);
        _updateDiscoveryIndex();
        if (stillAlive) {
          emitter.emit({ type: "warning", name, message: `Process ${pid} did not exit after SIGKILL` });
        } else {
          emitter.emit({ type: "stopped", name });
        }
      }
    }
    /* v8 ignore stop */
    });
  }

  async function killBot(name: BotName): Promise<void> {
    return withBotLock(name, async () => {
    const lp = live.get(name);
    if (!lp) {
      const state = readState(_botDir(name));
      if (!state) throw new BotNotFoundError(name);
      if (state.pid && isPidAlive(state.pid)) {
        safePidKill(state.pid, "SIGKILL");
      }
      state.state = "stopped";
      state.stoppedAt = new Date().toISOString();
      writeState(_botDir(name), state);
      _updateDiscoveryIndex();
      emitter.emit({ type: "stopped", name });
      return;
    }

    try { lp.child.kill("SIGKILL"); } catch (err) {
      /* v8 ignore start -- only ESRCH expected */
      if ((err as NodeJS.ErrnoException).code !== "ESRCH") throw err;
      /* v8 ignore stop */
    }
    const killed = await waitForChildExit(lp.child, DEFAULTS.STOP_GRACE_MS);
    /* v8 ignore start -- SIGKILL-surviving edge case */
    if (!killed && live.has(name)) {
      live.delete(name);
      const state = readState(_botDir(name));
      if (state && state.state === "running") {
        state.state = "error";
        writeState(_botDir(name), state);
        _updateDiscoveryIndex();
        emitter.emit({ type: "warning", name, message: `Process did not exit after SIGKILL` });
      }
    }
    /* v8 ignore stop */
    });
  }

  function getLogs(name: BotName, logOpts?: LogOpts): Readable {
    return readLogs(_botDir(name), name, logOpts);
  }

  function getPortAndToken(name: BotName): { port: number; token: string } | undefined {
    const lp = live.get(name);
    if (lp) return { port: lp.port, token: lp.token };

    const botDir = _botDir(name);
    const state = readState(botDir);
    if (state?.state === "running" && state.pid && isPidAlive(state.pid)) {
      const config = readBotConfig(botDir);
      if (config) return { port: config.port, token: config.token };
    }
    return undefined;
  }

  function onEvent(handler: (event: ProcessEvent) => void): () => void {
    return emitter.subscribe(handler);
  }

  return {
    spawn,
    get: getBot,
    list: listBots,
    stop: stopBot,
    kill: killBot,
    logs: getLogs,
    getPortAndToken,
    onEvent,
  };
}
