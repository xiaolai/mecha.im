import { type ChildProcess } from "node:child_process";
import { openSync, closeSync, chmodSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import {
  type BotName,
  BotAlreadyExistsError,
  DEFAULTS,
  ProcessSpawnError,
  readBotConfig,
} from "@mecha/core";
import type { Sandbox } from "@mecha/sandbox";
import { writeFileSync } from "node:fs";
import { profileFromConfig } from "@mecha/sandbox";
import type { PersistedSandboxProfile, SandboxPlatform } from "@mecha/sandbox";
import { allocatePort } from "./port.js";
import { waitForHealthy } from "./health.js";
import { readState, writeState } from "./state-store.js";
import type { BotState } from "./state-store.js";
import type { ProcessEventEmitter } from "./events.js";
import { isPidAlive, waitForPidExit } from "./process-lifecycle.js";
import { checkPort } from "./port.js";
import { prepareBotFilesystem } from "./sandbox-setup.js";
import type { SpawnOpts, ProcessInfo, LiveProcess, CreateProcessManagerOpts } from "./types.js";

export interface SpawnContext {
  opts: CreateProcessManagerOpts;
  mechaDir: string;
  healthTimeoutMs: number;
  sandbox?: Sandbox;
  spawnFn: typeof import("node:child_process").spawn;
  emitter: ProcessEventEmitter;
  live: Map<string, LiveProcess>;
  botDir: (name: string) => string;
  /** Called after state changes that affect the discovery index. */
  onStateChange?: () => void;
}

export async function spawnBot(ctx: SpawnContext, spawnOpts: SpawnOpts): Promise<ProcessInfo> {
  const { name } = spawnOpts;
  // Resolve symlinks so session path encoding matches the Claude SDK's realpathSync behavior.
  // On macOS, /tmp → /private/tmp; without this, sessions are stored under a different
  // encoded directory than the session manager looks for (R5-002).
  const resolved = resolve(spawnOpts.workspacePath);
  let workspacePath: string;
  try {
    workspacePath = realpathSync(resolved);
  /* v8 ignore start -- fallback for nonexistent workspace paths in tests */
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      workspacePath = resolved;
    } else {
      throw err;
    }
  }
  /* v8 ignore stop */
  const botDir = ctx.botDir(name);
  const { live } = ctx;

  // Check not already exists and running
  if (live.has(name)) {
    throw new BotAlreadyExistsError(name);
  }
  const existing = readState(botDir);
  if (existing && existing.state === "running" && existing.pid && isPidAlive(existing.pid)) {
    throw new BotAlreadyExistsError(name);
  }
  // Kill stale process if state says stopped/error but PID is still alive (R4-002 fix).
  // This prevents token mismatch: new spawn writes new token to config.json while
  // old process is still running with old token on the same port.
  // Port validation prevents killing an unrelated process after PID reuse:
  // only kill if our recorded port is still in use (i.e. the stale bot is listening).
  // Note: TOCTOU race between isPidAlive and kill is inherent to Unix process
  // management; the port check narrows the window to near-zero probability.
  /* v8 ignore start -- stale PID cleanup: requires real zombie process with active port */
  if (existing?.pid && isPidAlive(existing.pid) && existing.port) {
    const portFree = await checkPort(existing.port);
    if (!portFree) {
      try {
        process.kill(existing.pid, "SIGKILL");
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ESRCH") throw err;
      }
      const exited = await waitForPidExit(existing.pid, DEFAULTS.STALE_PROCESS_KILL_TIMEOUT_MS);
      if (!exited) {
        throw new ProcessSpawnError(
          `Stale process ${existing.pid} did not exit after SIGKILL (port ${existing.port})`,
        );
      }
    }
  }
  /* v8 ignore stop */

  // Allocate port — uses atomic TCP bind to prevent cross-process races (R7-004).
  // claimPort() holds the port until release() is called after the bot binds it.
  let port: number;
  let releasePort: (() => Promise<void>) | undefined;
  if (spawnOpts.port !== undefined) {
    port = spawnOpts.port;
  } else {
    const usedPorts = new Set<number>();
    for (const lp of live.values()) usedPorts.add(lp.port);
    const claim = await allocatePort(undefined, undefined, usedPorts);
    port = claim.port;
    releasePort = claim.release;
  }
  try {
    return await _spawnBotInner(ctx, spawnOpts, name, workspacePath, botDir, port, releasePort);
  } finally {
    // Ensure port claim is released even if _spawnBotInner fails before its own release call.
    // claimPort release is idempotent — safe to call again after _spawnBotInner already released.
    await releasePort?.();
  }
}

/** Best-effort state write — logs failures instead of crashing event handlers. */
function safeWriteState(botDir: string, state: BotState, name: string): void {
  try {
    writeState(botDir, state);
  /* v8 ignore start -- disk-full guard */
  } catch (err) {
    console.error(`[mecha:process] Failed to write state for ${name}: ${err instanceof Error ? err.message : String(err)}`);
  }
  /* v8 ignore stop */
}

/** Inner spawn logic — separated so port claim cleanup is guaranteed by the caller. */
async function _spawnBotInner(
  ctx: SpawnContext, spawnOpts: SpawnOpts,
  name: BotName, workspacePath: string, botDir: string, port: number,
  releasePort?: () => Promise<void>,
): Promise<ProcessInfo> {
  const { mechaDir, emitter, live } = ctx;
  const { model, permissionMode, auth, tags, home } = spawnOpts;
  const token = "mecha_" + randomBytes(24).toString("hex");

  // Prepare filesystem and environment
  const { logsDir, childEnv } = prepareBotFilesystem({
    botDir, workspacePath, port, token, name, mechaDir, model, permissionMode, auth, tags,
    expose: spawnOpts.expose,
    userEnv: spawnOpts.env,
    meterOff: spawnOpts.meterOff,
    home,
    systemPrompt: spawnOpts.systemPrompt,
    appendSystemPrompt: spawnOpts.appendSystemPrompt,
    effort: spawnOpts.effort,
    maxBudgetUsd: spawnOpts.maxBudgetUsd,
    allowedTools: spawnOpts.allowedTools,
    disallowedTools: spawnOpts.disallowedTools,
    tools: spawnOpts.tools,
    agent: spawnOpts.agent,
    agents: spawnOpts.agents,
    sessionPersistence: spawnOpts.sessionPersistence,
    budgetLimit: spawnOpts.budgetLimit,
    mcpServers: spawnOpts.mcpServers,
    mcpConfigFiles: spawnOpts.mcpConfigFiles,
    strictMcpConfig: spawnOpts.strictMcpConfig,
    pluginDirs: spawnOpts.pluginDirs,
    disableSlashCommands: spawnOpts.disableSlashCommands,
    addDirs: spawnOpts.addDirs,
    dangerouslySkipPermissions: spawnOpts.dangerouslySkipPermissions,
    allowDangerouslySkipPermissions: spawnOpts.allowDangerouslySkipPermissions,
    fallbackModel: spawnOpts.fallbackModel,
  });

  // Determine runtime binary path
  // Priority: per-spawn runtimeBin > constructor runtimeBin > constructor runtimeEntrypoint
  const effectiveBin = spawnOpts.runtimeBin ?? ctx.opts.runtimeBin;
  let spawnBin = effectiveBin ?? process.execPath;
  let spawnArgs: string[];
  if (spawnOpts.runtimeBin) {
    // Per-spawn override: standalone binary, no extra args
    spawnArgs = [];
  } else if (ctx.opts.runtimeBin) {
    // Constructor-level binary: apply constructor runtimeArgs (e.g. ["__runtime"])
    spawnArgs = [...(ctx.opts.runtimeArgs ?? [])];
  } else if (ctx.opts.runtimeEntrypoint) {
    spawnArgs = [ctx.opts.runtimeEntrypoint];
  } else {
    throw new ProcessSpawnError("No runtimeEntrypoint configured and no runtimeBin provided");
  }

  // Sandbox wrapping — BEFORE FD open to prevent leaks on failure
  const sandboxMode = spawnOpts.sandboxMode ?? "auto";
  /* v8 ignore start -- sandbox integration tested via CLI E2E, unit tests don't inject sandbox DI */
  const { bin: spawnBinFinal, args: spawnArgsFinal, platform: sandboxPlatform } =
    await applySandboxWrapping({
      ctx, sandboxMode, botDir, mechaDir, name, spawnBin, spawnArgs, emitter,
    });
  spawnBin = spawnBinFinal;
  spawnArgs = spawnArgsFinal;
  /* v8 ignore stop */

  // Open log files as FDs and enforce 0o600 permissions (owner-only read/write).
  // openSync mode only applies on creation; chmodSync ensures existing files are hardened too.
  // Guard FD acquisition to prevent leaks if chmodSync or second openSync fails.
  const stdoutPath = join(logsDir, "stdout.log");
  const stderrPath = join(logsDir, "stderr.log");
  let stdoutFd = -1;
  let stderrFd = -1;
  try {
    stdoutFd = openSync(stdoutPath, "a", 0o600);
    chmodSync(stdoutPath, 0o600);
    stderrFd = openSync(stderrPath, "a", 0o600);
    chmodSync(stderrPath, 0o600);
  } catch (err) {
    /* v8 ignore start -- FD cleanup on log open failure */
    if (stdoutFd !== -1) closeSync(stdoutFd);
    if (stderrFd !== -1) closeSync(stderrFd);
    throw new ProcessSpawnError(err instanceof Error ? err.message : String(err), { cause: err });
    /* v8 ignore stop */
  }

  // Release port claim just before spawn — the bot process needs to bind it.
  // The claim prevented other concurrent allocatePort() calls from choosing this port.
  // Await ensures the OS has fully released the socket before the child tries to bind.
  await releasePort?.();

  // Spawn child process
  let child: ChildProcess;
  try {
    child = ctx.spawnFn(spawnBin, spawnArgs, {
      env: childEnv,
      cwd: workspacePath,
      detached: true,
      stdio: ["ignore", stdoutFd, stderrFd],
    });
  } catch (err) {
    closeSync(stdoutFd);
    closeSync(stderrFd);
    throw new ProcessSpawnError(err instanceof Error ? err.message : String(err), { cause: err });
  }

  // Register error handler IMMEDIATELY after spawn, before anything else.
  // Node.js queues an async 'error' event on next tick for ENOENT failures;
  // if we throw (e.g. at the !child.pid guard) before attaching a listener,
  // the queued event becomes an unhandled 'error' that crashes the process.
  /* v8 ignore start -- async spawn error handler: requires binary to fail after initial spawn */
  child.on("error", (err) => {
    live.delete(name);
    const errorState: BotState = {
      name, state: "error", pid: child.pid ?? undefined, port, workspacePath,
      startedAt: new Date().toISOString(), stoppedAt: new Date().toISOString(),
    };
    safeWriteState(botDir, errorState, name);
    ctx.onStateChange?.();
    emitter.emit({ type: "error", name, error: err.message });
  });
  /* v8 ignore stop */

  closeSync(stdoutFd);
  closeSync(stderrFd);

  if (!child.pid) {
    throw new ProcessSpawnError("Failed to get child PID");
  }

  child.unref();
  const startedAt = new Date().toISOString();

  const lp: LiveProcess = { child, port, token, name };
  live.set(name, lp);

  // Handle child exit
  child.on("exit", (code, signal) => {
    live.delete(name);
    // Determine if exit was abnormal:
    // - Non-zero exit code → error
    // - Unexpected signal (SIGKILL, SIGABRT, etc.) → error; SIGTERM is normal (`bot stop`)
    // - code=null && signal=null → detached/unref'd child was killed externally (e.g. SIGKILL);
    //   Node.js can't determine the signal for detached children, treat as error
    // - code=0 → clean exit
    const isCleanExit = code === 0 || (code === null && signal === "SIGTERM");
    const isError = !isCleanExit;
    const state: BotState = {
      name,
      state: isError ? "error" : "stopped",
      /* v8 ignore start -- pid always set after spawn guard */
      pid: child.pid ?? undefined,
      /* v8 ignore stop */
      port,
      workspacePath,
      startedAt,
      stoppedAt: new Date().toISOString(),
      exitCode: code ?? undefined,
    };
    safeWriteState(ctx.botDir(name), state, name);
    ctx.onStateChange?.();
    emitter.emit({ type: "stopped", name, exitCode: code ?? undefined, signal: signal ?? undefined });
  });

  // Wait for healthy — clean up on failure
  try {
    await waitForHealthy(port, token, ctx.healthTimeoutMs, name);
  } catch (err) {
    live.delete(name);
    child.kill("SIGKILL");
    const failState: BotState = {
      name, state: "error", pid: child.pid, port, workspacePath, startedAt,
      stoppedAt: new Date().toISOString(),
    };
    safeWriteState(botDir, failState, name);
    ctx.onStateChange?.();
    /* v8 ignore start -- waitForHealthy always throws Error */
    emitter.emit({ type: "error", name, error: err instanceof Error ? err.message : String(err) });
    /* v8 ignore stop */
    throw err;
  }

  const state: BotState = {
    name, state: "running", pid: child.pid, port, workspacePath, startedAt,
    sandboxPlatform, sandboxMode,
  };
  /* v8 ignore start -- disk-full guard: prevent orphaned child on state write failure */
  try {
    writeState(botDir, state);
  } catch (err) {
    live.delete(name);
    child.kill("SIGKILL");
    const errState: BotState = {
      name, state: "error", pid: child.pid, port, workspacePath, startedAt,
      stoppedAt: new Date().toISOString(),
    };
    safeWriteState(botDir, errState, name);
    ctx.onStateChange?.();
    throw new ProcessSpawnError(
      `Failed to write running state: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
  /* v8 ignore stop */

  emitter.emit({ type: "spawned", name, pid: child.pid, port });

  return { name, state: "running", pid: child.pid, port, workspacePath, token, startedAt };
}

/** Apply sandbox wrapping to spawn binary/args if sandbox is available and enabled. */
/* v8 ignore start -- sandbox integration tested via CLI E2E */
async function applySandboxWrapping(opts: {
  ctx: SpawnContext; sandboxMode: string; botDir: string; mechaDir: string;
  name: BotName; spawnBin: string; spawnArgs: string[]; emitter: ProcessEventEmitter;
}): Promise<{ bin: string; args: string[]; platform: SandboxPlatform | undefined }> {
  const { ctx, sandboxMode, botDir, mechaDir, name, emitter } = opts;
  let bin = opts.spawnBin;
  let args = opts.spawnArgs;
  let platform: SandboxPlatform | undefined;

  if (sandboxMode !== "off" && ctx.sandbox) {
    const available = ctx.sandbox.isAvailable();
    if (sandboxMode === "require" && !available) {
      throw new ProcessSpawnError(`Sandbox required but ${ctx.sandbox.describe()}`);
    }
    if (available) {
      const config = readBotConfig(botDir);
      if (!config && sandboxMode === "require") {
        throw new ProcessSpawnError("Sandbox required but config.json could not be read for profile generation");
      }
      if (config) {
        const profile = profileFromConfig({
          config, botDir, mechaDir, runtimeEntrypoint: ctx.opts.runtimeEntrypoint,
        });
        const wrapped = await ctx.sandbox.wrap(profile, bin, args, botDir);
        bin = wrapped.bin;
        args = wrapped.args;
        platform = ctx.sandbox.platform;
        const persisted: PersistedSandboxProfile = {
          platform: ctx.sandbox.platform, profile, createdAt: new Date().toISOString(),
        };
        const sandboxProfilePath = join(botDir, "sandbox-profile.json");
        writeFileSync(sandboxProfilePath, JSON.stringify(persisted, null, 2) + "\n", { mode: 0o600 });
        chmodSync(sandboxProfilePath, 0o600);
      }
    } else if (sandboxMode === "auto") {
      emitter.emit({ type: "warning", name, message: "Kernel sandbox not available, running without sandbox" });
    }
  }

  return { bin, args, platform };
}
/* v8 ignore stop */
