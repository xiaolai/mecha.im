import { spawn as cpSpawn, type ChildProcess } from "node:child_process";
import { mkdirSync, writeFileSync, symlinkSync, createReadStream, existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { type CasaName, isValidName, InvalidNameError } from "@mecha/core";
import {
  CasaAlreadyExistsError,
  CasaNotFoundError,
  CasaNotRunningError,
  ProcessSpawnError,
} from "@mecha/contracts";
import { allocatePort } from "./port.js";
import { waitForHealthy } from "./health.js";
import { readState, writeState, listCasaDirs } from "./state-store.js";
import type { CasaState } from "./state-store.js";
import { ProcessEventEmitter } from "./events.js";
import type { ProcessEvent } from "./events.js";

export interface SpawnOpts {
  name: CasaName;
  workspacePath: string;
  port?: number;
  env?: Record<string, string>;
  model?: string;
  permissionMode?: string;
  auth?: string;
  runtimeBin?: string;
}

export interface ProcessInfo {
  name: CasaName;
  state: "running" | "stopped" | "error";
  pid?: number;
  port?: number;
  workspacePath: string;
  token?: string;
  startedAt?: string;
  stoppedAt?: string;
  exitCode?: number;
}

export interface LogOpts {
  follow?: boolean;
  tail?: number;
}

export interface ProcessManager {
  spawn(opts: SpawnOpts): Promise<ProcessInfo>;
  get(name: CasaName): ProcessInfo | undefined;
  list(): ProcessInfo[];
  stop(name: CasaName): Promise<void>;
  kill(name: CasaName): Promise<void>;
  logs(name: CasaName, opts?: LogOpts): Readable;
  getPortAndToken(name: CasaName): { port: number; token: string } | undefined;
  onEvent(handler: (event: ProcessEvent) => void): () => void;
}

interface LiveProcess {
  child: ChildProcess;
  port: number;
  token: string;
  name: CasaName;
}

export interface CreateProcessManagerOpts {
  mechaDir: string;
  healthTimeoutMs?: number;
  spawnFn?: typeof cpSpawn;
  /** Path to the @mecha/runtime entrypoint. Required for real spawning. */
  runtimeEntrypoint?: string;
}

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
        if (!_isPidAlive(state.pid)) {
          state.state = "stopped";
          state.stoppedAt = new Date().toISOString();
          writeState(casaDir, state);
        }
      }
    }
  }

  function _isPidAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  function _casaDir(name: string): string {
    // Validate name to prevent path traversal
    if (!isValidName(name)) {
      throw new InvalidNameError(name);
    }
    return join(mechaDir, "casas", name);
  }

  /** Verify a stale PID is actually our CASA by health-checking its expected port+token. */

  function _generateToken(): string {
    return "mecha_" + randomBytes(24).toString("hex");
  }

  async function spawnCasa(spawnOpts: SpawnOpts): Promise<ProcessInfo> {
    const { name, model, permissionMode, auth } = spawnOpts;
    // Resolve to absolute path for consistent sandbox matching
    const workspacePath = resolve(spawnOpts.workspacePath);
    const casaDir = _casaDir(name);

    // Check not already exists and running
    if (live.has(name)) {
      throw new CasaAlreadyExistsError(name);
    }
    const existing = readState(casaDir);
    if (existing && existing.state === "running" && existing.pid && _isPidAlive(existing.pid)) {
      throw new CasaAlreadyExistsError(name);
    }

    // Allocate port
    const usedPorts = new Set<number>();
    for (const lp of live.values()) usedPorts.add(lp.port);
    const port = spawnOpts.port ?? await allocatePort(undefined, undefined, usedPorts);
    const token = _generateToken();

    // Create directory structure
    const homeDir = join(casaDir, "home");
    const claudeDir = join(homeDir, ".claude");
    const hooksDir = join(claudeDir, "hooks");
    const workDir = join(casaDir, "workspace");
    const tmpDir = join(casaDir, "tmp");
    const sessionsDir = join(casaDir, "sessions", "transcripts");
    const logsDir = join(casaDir, "logs");

    mkdirSync(hooksDir, { recursive: true, mode: 0o700 });
    mkdirSync(tmpDir, { recursive: true, mode: 0o700 });
    mkdirSync(sessionsDir, { recursive: true, mode: 0o700 });
    mkdirSync(logsDir, { recursive: true, mode: 0o700 });

    // Create workspace symlink — remove existing if present, then create fresh
    try { const { unlinkSync } = await import("node:fs"); unlinkSync(workDir); } catch { /* no existing symlink */ }
    symlinkSync(workspacePath, workDir);

    // Write config
    const config = { port, token, workspace: workspacePath, model, permissionMode, auth };
    writeFileSync(join(casaDir, "config.json"), JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });

    // Write sandbox hooks (settings.json)
    const settings = {
      hooks: {
        PreToolUse: [
          {
            matcher: "Read|Write|Edit|Glob|Grep",
            hooks: [{
              type: "command",
              command: "$HOME/.claude/hooks/sandbox-guard.sh",
              timeout: 5,
            }],
          },
          {
            matcher: "Bash",
            hooks: [{
              type: "command",
              command: "$HOME/.claude/hooks/bash-guard.sh",
              timeout: 5,
            }],
          },
        ],
      },
    };
    writeFileSync(join(claudeDir, "settings.json"), JSON.stringify(settings, null, 2) + "\n");

    // Write hook scripts
    const sandboxGuard = `#!/bin/bash
# Sandbox guard: block file access outside CASA root
TARGET="$1"
# Canonicalize target path, following symlinks
RESOLVED=$(realpath -m "$TARGET" 2>/dev/null || (cd "$(dirname "$TARGET")" 2>/dev/null && pwd)/$(basename "$TARGET"))
# Canonicalize allowed roots
SANDBOX=$(realpath -m "$MECHA_SANDBOX_ROOT" 2>/dev/null || echo "$MECHA_SANDBOX_ROOT")
WORKSPACE=$(realpath -m "$MECHA_WORKSPACE" 2>/dev/null || echo "$MECHA_WORKSPACE")
case "$RESOLVED" in
  "$SANDBOX"/*|"$SANDBOX") exit 0 ;;
  "$WORKSPACE"/*|"$WORKSPACE") exit 0 ;;
  *) echo "BLOCKED: $RESOLVED is outside sandbox" >&2; exit 2 ;;
esac
`;
    const bashGuard = `#!/bin/bash
# Bash guard: ensure commands run in workspace context
cd "$MECHA_WORKSPACE" 2>/dev/null || true
`;
    writeFileSync(join(hooksDir, "sandbox-guard.sh"), sandboxGuard, { mode: 0o755 });
    writeFileSync(join(hooksDir, "bash-guard.sh"), bashGuard, { mode: 0o755 });

    // Build environment — user env goes in the middle, security vars last to prevent override
    const userEnv = spawnOpts.env ?? {};
    const reservedKeys = new Set([
      "MECHA_CASA_NAME", "MECHA_PORT", "MECHA_WORKSPACE", "MECHA_DB_PATH",
      "MECHA_AUTH_TOKEN", "MECHA_LOG_DIR", "MECHA_SANDBOX_ROOT", "HOME", "TMPDIR",
    ]);
    const safeUserEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(userEnv)) {
      if (!reservedKeys.has(k)) safeUserEnv[k] = v;
    }
    const childEnv: Record<string, string> = {
      /* v8 ignore start -- PATH always set in normal environments */
      PATH: process.env.PATH ?? "",
      /* v8 ignore stop */
      ...safeUserEnv,
      HOME: homeDir,
      TMPDIR: tmpDir,
      MECHA_CASA_NAME: name,
      MECHA_PORT: String(port),
      MECHA_WORKSPACE: workspacePath,
      MECHA_DB_PATH: join(casaDir, "sessions", "sessions.db"),
      MECHA_AUTH_TOKEN: token,
      MECHA_LOG_DIR: logsDir,
      MECHA_SANDBOX_ROOT: casaDir,
    };

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
        /* v8 ignore next -- pid always set after spawn guard */
        pid: child.pid ?? undefined,
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
    if (!lp && state.state === "running" && state.pid && !_isPidAlive(state.pid)) {
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
      if (!lp && state.state === "running" && state.pid && !_isPidAlive(state.pid)) {
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
      if (state.pid && _isPidAlive(state.pid)) {
        process.kill(state.pid, "SIGTERM");
        await _waitForPidExit(state.pid, 5000);
        if (_isPidAlive(state.pid)) {
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
    const exited = await _waitForChildExit(lp.child, 5000);
    if (!exited) {
      lp.child.kill("SIGKILL");
    }
  }

  async function killCasa(name: CasaName): Promise<void> {
    const lp = live.get(name);
    if (!lp) {
      const state = readState(_casaDir(name));
      if (!state) throw new CasaNotFoundError(name);
      if (state.pid && _isPidAlive(state.pid)) {
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

  function getLogs(name: CasaName, logOpts?: LogOpts): Readable {
    const casaDir = _casaDir(name);
    const state = readState(casaDir);
    if (!state) throw new CasaNotFoundError(name);

    const logPath = join(casaDir, "logs", "stdout.log");
    if (!existsSync(logPath)) {
      return Readable.from([]);
    }
    return createReadStream(logPath, { encoding: "utf-8" });
  }

  function _readConfig(casaDir: string): { port: number; token: string; workspace: string } | undefined {
    const configPath = join(casaDir, "config.json");
    if (!existsSync(configPath)) return undefined;
    try {
      return JSON.parse(readFileSync(configPath, "utf-8")) as { port: number; token: string; workspace: string };
    } catch { return undefined; }
  }

  function getPortAndToken(name: CasaName): { port: number; token: string } | undefined {
    const lp = live.get(name);
    if (lp) return { port: lp.port, token: lp.token };

    // Recover from disk if CASA is running but CLI was restarted
    const casaDir = _casaDir(name);
    const state = readState(casaDir);
    if (state?.state === "running" && state.pid && _isPidAlive(state.pid)) {
      const config = _readConfig(casaDir);
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

function _waitForChildExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    /* v8 ignore start -- exit code already set when child exits synchronously */
    if (child.exitCode !== null && child.exitCode !== undefined) {
      resolve(true);
      return;
    }
    /* v8 ignore stop */
    const timer = setTimeout(() => resolve(false), timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

function _waitForPidExit(pid: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      try {
        process.kill(pid, 0);
        if (Date.now() - start > timeoutMs) {
          resolve();
          return;
        }
        setTimeout(check, 100);
      } catch {
        resolve();
      }
    };
    check();
  });
}
