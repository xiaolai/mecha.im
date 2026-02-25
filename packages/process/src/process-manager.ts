import { spawn as cpSpawn, type ChildProcess } from "node:child_process";
import { createReadStream, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import {
  type CasaName,
  isValidName,
  InvalidNameError,
  CasaAlreadyExistsError,
  CasaNotFoundError,
  CasaNotRunningError,
  ProcessSpawnError,
  readCasaConfig,
} from "@mecha/core";
import { allocatePort } from "./port.js";
import { waitForHealthy } from "./health.js";
import { readState, writeState, listCasaDirs } from "./state-store.js";
import type { CasaState } from "./state-store.js";
import { ProcessEventEmitter } from "./events.js";
import type { ProcessEvent } from "./events.js";
import { isPidAlive, waitForChildExit, waitForPidExit } from "./process-lifecycle.js";
import { prepareCasaFilesystem } from "./sandbox-setup.js";
import type {
  SpawnOpts,
  ProcessInfo,
  LogOpts,
  ProcessManager,
  LiveProcess,
  CreateProcessManagerOpts,
} from "./types.js";

export type { SpawnOpts, ProcessInfo, LogOpts, ProcessManager, CreateProcessManagerOpts };

export function createProcessManager(opts: CreateProcessManagerOpts): ProcessManager {
  const { mechaDir, healthTimeoutMs = 10_000 } = opts;
  const spawnFn = opts.spawnFn ?? cpSpawn;
  const emitter = new ProcessEventEmitter();
  const live = new Map<string, LiveProcess>();

  // On init, scan for existing state and check PID liveness
  _recoverState();

  function _recoverState(): void {
    for (const casaDir of listCasaDirs(mechaDir)) {
      const state = readState(casaDir);
      if (!state) continue;
      if (state.state === "running" && state.pid) {
        if (!isPidAlive(state.pid)) {
          state.state = "stopped";
          state.stoppedAt = new Date().toISOString();
          writeState(casaDir, state);
        }
      }
    }
  }

  function _casaDir(name: string): string {
    // Validate name to prevent path traversal
    if (!isValidName(name)) {
      throw new InvalidNameError(name);
    }
    return join(mechaDir, name);
  }

  function _generateToken(): string {
    return "mecha_" + randomBytes(24).toString("hex");
  }

  async function spawnCasa(spawnOpts: SpawnOpts): Promise<ProcessInfo> {
    const { name, model, permissionMode, auth, tags } = spawnOpts;
    // Resolve to absolute path for consistent sandbox matching
    const workspacePath = resolve(spawnOpts.workspacePath);
    const casaDir = _casaDir(name);

    // Check not already exists and running
    if (live.has(name)) {
      throw new CasaAlreadyExistsError(name);
    }
    const existing = readState(casaDir);
    if (existing && existing.state === "running" && existing.pid && isPidAlive(existing.pid)) {
      throw new CasaAlreadyExistsError(name);
    }

    // Allocate port
    const usedPorts = new Set<number>();
    for (const lp of live.values()) usedPorts.add(lp.port);
    const port = spawnOpts.port ?? await allocatePort(undefined, undefined, usedPorts);
    const token = _generateToken();

    // Prepare filesystem and environment
    const { logsDir, childEnv } = prepareCasaFilesystem({
      casaDir, workspacePath, port, token, name, mechaDir, model, permissionMode, auth, tags,
      expose: spawnOpts.expose,
      userEnv: spawnOpts.env,
    });

    // Determine runtime binary path
    const runtimeBin = spawnOpts.runtimeBin ?? process.execPath;
    let runtimeArgs: string[];
    if (spawnOpts.runtimeBin) {
      runtimeArgs = [];
    } else if (opts.runtimeEntrypoint) {
      runtimeArgs = [opts.runtimeEntrypoint];
    } else {
      throw new ProcessSpawnError("No runtimeEntrypoint configured and no runtimeBin provided");
    }

    // Spawn child process
    let child: ChildProcess;
    try {
      child = spawnFn(runtimeBin, runtimeArgs, {
        env: childEnv,
        cwd: workspacePath,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      throw new ProcessSpawnError(
        err instanceof Error ? err.message : String(err),
      );
    }

    if (!child.pid) {
      throw new ProcessSpawnError("Failed to get child PID");
    }

    // Pipe stdout/stderr to log files
    const { createWriteStream } = await import("node:fs");
    if (child.stdout) {
      child.stdout.pipe(createWriteStream(join(logsDir, "stdout.log"), { flags: "a" }));
    }
    if (child.stderr) {
      child.stderr.pipe(createWriteStream(join(logsDir, "stderr.log"), { flags: "a" }));
    }

    // Detach so CLI can exit without killing child
    child.unref();

    const startedAt = new Date().toISOString();

    // Track in live map
    const lp: LiveProcess = { child, port, token, name };
    live.set(name, lp);

    // Handle child exit
    child.on("exit", (code) => {
      live.delete(name);
      const state: CasaState = {
        name,
        state: "stopped",
        /* v8 ignore start -- pid always set after spawn guard */
        pid: child.pid ?? undefined,
        /* v8 ignore stop */
        port,
        workspacePath,
        startedAt,
        stoppedAt: new Date().toISOString(),
        exitCode: code ?? undefined,
      };
      writeState(_casaDir(name), state);
      emitter.emit({ type: "stopped", name, exitCode: code ?? undefined });
    });

    // Wait for healthy — clean up on failure
    try {
      await waitForHealthy(port, token, healthTimeoutMs, name);
    } catch (err) {
      live.delete(name);
      child.kill("SIGKILL");
      const failState: CasaState = {
        name, state: "error", pid: child.pid, port, workspacePath, startedAt,
        stoppedAt: new Date().toISOString(),
      };
      writeState(casaDir, failState);
      /* v8 ignore start -- waitForHealthy always throws Error */
      emitter.emit({ type: "error", name, error: err instanceof Error ? err.message : String(err) });
      /* v8 ignore stop */
      throw err;
    }

    // Write state
    const state: CasaState = {
      name,
      state: "running",
      pid: child.pid,
      port,
      workspacePath,
      startedAt,
    };
    writeState(casaDir, state);

    emitter.emit({ type: "spawned", name, pid: child.pid, port });

    return {
      name,
      state: "running",
      pid: child.pid,
      port,
      workspacePath,
      token,
      startedAt,
    };
  }

  function getCasa(name: CasaName): ProcessInfo | undefined {
    const casaDir = _casaDir(name);
    const state = readState(casaDir);
    if (!state) return undefined;

    const lp = live.get(name);

    // Verify liveness — skip if we have a live handle (PID may not match real OS process in tests)
    if (!lp && state.state === "running" && state.pid && !isPidAlive(state.pid)) {
      state.state = "stopped";
      state.stoppedAt = new Date().toISOString();
      writeState(casaDir, state);
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
    for (const casaDir of listCasaDirs(mechaDir)) {
      const state = readState(casaDir);
      if (!state) continue;

      const lp = live.get(state.name);

      // Check liveness — skip if we have a live handle
      if (!lp && state.state === "running" && state.pid && !isPidAlive(state.pid)) {
        state.state = "stopped";
        state.stoppedAt = new Date().toISOString();
        writeState(casaDir, state);
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
    return results;
  }

  async function stopCasa(name: CasaName): Promise<void> {
    const lp = live.get(name);
    if (!lp) {
      // Check if it exists at all
      const state = readState(_casaDir(name));
      if (!state) throw new CasaNotFoundError(name);
      if (state.state !== "running") throw new CasaNotRunningError(name);
      // It claims running but we don't have a live handle — signal the PID directly
      if (state.pid && isPidAlive(state.pid)) {
        process.kill(state.pid, "SIGTERM");
        await waitForPidExit(state.pid, 5000);
        if (isPidAlive(state.pid)) {
          process.kill(state.pid, "SIGKILL");
        }
      }
      state.state = "stopped";
      state.stoppedAt = new Date().toISOString();
      writeState(_casaDir(name), state);
      emitter.emit({ type: "stopped", name });
      return;
    }

    lp.child.kill("SIGTERM");
    const exited = await waitForChildExit(lp.child, 5000);
    if (!exited) {
      lp.child.kill("SIGKILL");
    }
  }

  async function killCasa(name: CasaName): Promise<void> {
    const lp = live.get(name);
    if (!lp) {
      const state = readState(_casaDir(name));
      if (!state) throw new CasaNotFoundError(name);
      if (state.pid && isPidAlive(state.pid)) {
        process.kill(state.pid, "SIGKILL");
      }
      state.state = "stopped";
      state.stoppedAt = new Date().toISOString();
      writeState(_casaDir(name), state);
      emitter.emit({ type: "stopped", name });
      return;
    }

    lp.child.kill("SIGKILL");
  }

  function getLogs(name: CasaName, _logOpts?: LogOpts): Readable {
    const casaDir = _casaDir(name);
    const state = readState(casaDir);
    if (!state) throw new CasaNotFoundError(name);

    const logPath = join(casaDir, "logs", "stdout.log");
    if (!existsSync(logPath)) {
      return Readable.from([]);
    }
    return createReadStream(logPath, { encoding: "utf-8" });
  }

  function getPortAndToken(name: CasaName): { port: number; token: string } | undefined {
    const lp = live.get(name);
    if (lp) return { port: lp.port, token: lp.token };

    // Recover from disk if CASA is running but CLI was restarted
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
    spawn: spawnCasa,
    get: getCasa,
    list: listCasas,
    stop: stopCasa,
    kill: killCasa,
    logs: getLogs,
    getPortAndToken,
    onEvent,
  };
}
