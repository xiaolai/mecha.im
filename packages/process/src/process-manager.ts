import { spawn as cpSpawn, type ChildProcess } from "node:child_process";
import { createReadStream, existsSync, openSync, closeSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import {
  type CasaName,
  type DiscoveryIndex,
  type DiscoveryIndexEntry,
  DEFAULTS,
  isValidName,
  InvalidNameError,
  CasaAlreadyExistsError,
  CasaNotFoundError,
  CasaNotRunningError,
  ProcessSpawnError,
  readCasaConfig,
} from "@mecha/core";
import type { Sandbox } from "@mecha/sandbox";
import { writeFileSync, renameSync } from "node:fs";
import { profileFromConfig } from "@mecha/sandbox";
import type { PersistedSandboxProfile } from "@mecha/sandbox";
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
  const { mechaDir, healthTimeoutMs = DEFAULTS.HEALTH_TIMEOUT_MS } = opts;
  const spawnFn = opts.spawnFn ?? cpSpawn;
  const sandbox = opts.sandbox;
  const emitter = new ProcessEventEmitter();
  const live = new Map<string, LiveProcess>();

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
    let spawnBin = spawnOpts.runtimeBin ?? process.execPath;
    let spawnArgs: string[];
    if (spawnOpts.runtimeBin) {
      spawnArgs = [];
    } else if (opts.runtimeEntrypoint) {
      spawnArgs = [opts.runtimeEntrypoint];
    } else {
      throw new ProcessSpawnError("No runtimeEntrypoint configured and no runtimeBin provided");
    }

    // Sandbox wrapping — BEFORE FD open to prevent leaks on failure
    const sandboxMode = spawnOpts.sandboxMode ?? "auto";
    let sandboxPlatform: import("@mecha/sandbox").SandboxPlatform | undefined;
    /* v8 ignore start -- sandbox integration tested via CLI E2E, unit tests don't inject sandbox DI */
    if (sandboxMode !== "off" && sandbox) {
      const available = sandbox.isAvailable();
      if (sandboxMode === "require" && !available) {
        throw new ProcessSpawnError(`Sandbox required but ${sandbox.describe()}`);
      }
      if (available) {
        const config = readCasaConfig(casaDir);
        if (config) {
          const profile = profileFromConfig({
            config, casaDir, mechaDir, runtimeEntrypoint: opts.runtimeEntrypoint,
          });
          const wrapped = await sandbox.wrap(profile, spawnBin, spawnArgs, casaDir);
          spawnBin = wrapped.bin;
          spawnArgs = wrapped.args;
          sandboxPlatform = sandbox.platform;
          // Persist sandbox profile for introspection
          const persisted: PersistedSandboxProfile = {
            platform: sandbox.platform, profile, createdAt: new Date().toISOString(),
          };
          writeFileSync(
            join(casaDir, "sandbox-profile.json"),
            JSON.stringify(persisted, null, 2) + "\n",
            { mode: 0o600 },
          );
        }
      } else if (sandboxMode === "auto") {
        emitter.emit({ type: "warning", name, message: "Kernel sandbox not available, running without sandbox" });
      }
    }
    /* v8 ignore stop */

    // Open log files as FDs — the OS writes directly so Node has no stream references
    // that would keep the event loop alive after child.unref().
    const stdoutFd = openSync(join(logsDir, "stdout.log"), "a");
    const stderrFd = openSync(join(logsDir, "stderr.log"), "a");

    // Spawn child process
    let child: ChildProcess;
    try {
      child = spawnFn(spawnBin, spawnArgs, {
        env: childEnv,
        cwd: workspacePath,
        detached: true,
        stdio: ["ignore", stdoutFd, stderrFd],
      });
    } catch (err) {
      closeSync(stdoutFd);
      closeSync(stderrFd);
      throw new ProcessSpawnError(
        err instanceof Error ? err.message : String(err),
      );
    }

    // Close FDs in parent — child has its own copies
    closeSync(stdoutFd);
    closeSync(stderrFd);

    if (!child.pid) {
      throw new ProcessSpawnError("Failed to get child PID");
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
      _updateDiscoveryIndex();
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
      sandboxPlatform,
      sandboxMode,
    };
    writeState(casaDir, state);
    _updateDiscoveryIndex();

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

      // Check liveness — skip if we have a live handle
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
      // Check if it exists at all
      const state = readState(_casaDir(name));
      if (!state) throw new CasaNotFoundError(name);
      if (state.state !== "running") throw new CasaNotRunningError(name);
      // It claims running but we don't have a live handle — signal the PID directly
      if (state.pid && isPidAlive(state.pid)) {
        process.kill(state.pid, "SIGTERM");
        await waitForPidExit(state.pid, DEFAULTS.STOP_GRACE_MS);
        if (isPidAlive(state.pid)) {
          process.kill(state.pid, "SIGKILL");
        }
      }
      state.state = "stopped";
      state.stoppedAt = new Date().toISOString();
      writeState(_casaDir(name), state);
      _updateDiscoveryIndex();
      emitter.emit({ type: "stopped", name });
      return;
    }

    lp.child.kill("SIGTERM");
    const exited = await waitForChildExit(lp.child, DEFAULTS.STOP_GRACE_MS);
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
      _updateDiscoveryIndex();
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
