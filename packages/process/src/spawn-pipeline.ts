import { type ChildProcess } from "node:child_process";
import { openSync, closeSync, chmodSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import {
  CasaAlreadyExistsError,
  ProcessSpawnError,
  readCasaConfig,
} from "@mecha/core";
import type { Sandbox } from "@mecha/sandbox";
import { writeFileSync } from "node:fs";
import { profileFromConfig } from "@mecha/sandbox";
import type { PersistedSandboxProfile, SandboxPlatform } from "@mecha/sandbox";
import { allocatePort } from "./port.js";
import { waitForHealthy } from "./health.js";
import { readState, writeState } from "./state-store.js";
import type { CasaState } from "./state-store.js";
import type { ProcessEventEmitter } from "./events.js";
import { isPidAlive } from "./process-lifecycle.js";
import { prepareCasaFilesystem } from "./sandbox-setup.js";
import type { SpawnOpts, ProcessInfo, LiveProcess, CreateProcessManagerOpts } from "./types.js";

export interface SpawnContext {
  opts: CreateProcessManagerOpts;
  mechaDir: string;
  healthTimeoutMs: number;
  sandbox?: Sandbox;
  spawnFn: typeof import("node:child_process").spawn;
  emitter: ProcessEventEmitter;
  live: Map<string, LiveProcess>;
  casaDir: (name: string) => string;
  /** Called after state changes that affect the discovery index. */
  onStateChange?: () => void;
}

export async function spawnCasa(ctx: SpawnContext, spawnOpts: SpawnOpts): Promise<ProcessInfo> {
  const { name, model, permissionMode, auth, tags } = spawnOpts;
  const workspacePath = resolve(spawnOpts.workspacePath);
  const casaDir = ctx.casaDir(name);
  const { mechaDir, emitter, live } = ctx;

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
  const token = "mecha_" + randomBytes(24).toString("hex");

  // Prepare filesystem and environment
  const { logsDir, childEnv } = prepareCasaFilesystem({
    casaDir, workspacePath, port, token, name, mechaDir, model, permissionMode, auth, tags,
    expose: spawnOpts.expose,
    userEnv: spawnOpts.env,
    meterOff: spawnOpts.meterOff,
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
  let sandboxPlatform: SandboxPlatform | undefined;
  /* v8 ignore start -- sandbox integration tested via CLI E2E, unit tests don't inject sandbox DI */
  if (sandboxMode !== "off" && ctx.sandbox) {
    const available = ctx.sandbox.isAvailable();
    if (sandboxMode === "require" && !available) {
      throw new ProcessSpawnError(`Sandbox required but ${ctx.sandbox.describe()}`);
    }
    if (available) {
      const config = readCasaConfig(casaDir);
      if (config) {
        const profile = profileFromConfig({
          config, casaDir, mechaDir, runtimeEntrypoint: ctx.opts.runtimeEntrypoint,
        });
        const wrapped = await ctx.sandbox.wrap(profile, spawnBin, spawnArgs, casaDir);
        spawnBin = wrapped.bin;
        spawnArgs = wrapped.args;
        sandboxPlatform = ctx.sandbox.platform;
        const persisted: PersistedSandboxProfile = {
          platform: ctx.sandbox.platform, profile, createdAt: new Date().toISOString(),
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

  // Open log files as FDs and enforce 0o600 permissions (owner-only read/write).
  // openSync mode only applies on creation; chmodSync ensures existing files are hardened too.
  const stdoutPath = join(logsDir, "stdout.log");
  const stderrPath = join(logsDir, "stderr.log");
  const stdoutFd = openSync(stdoutPath, "a", 0o600);
  chmodSync(stdoutPath, 0o600);
  const stderrFd = openSync(stderrPath, "a", 0o600);
  chmodSync(stderrPath, 0o600);

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

  closeSync(stdoutFd);
  closeSync(stderrFd);

  if (!child.pid) {
    throw new ProcessSpawnError("Failed to get child PID");
  }

  // Handle async spawn errors (e.g. EACCES, binary not found after initial spawn)
  child.on("error", (err) => {
    live.delete(name);
    const errorState: CasaState = {
      name, state: "error", pid: child.pid ?? undefined, port, workspacePath,
      startedAt: new Date().toISOString(), stoppedAt: new Date().toISOString(),
    };
    writeState(casaDir, errorState);
    ctx.onStateChange?.();
    emitter.emit({ type: "error", name, error: err.message });
  });

  child.unref();
  const startedAt = new Date().toISOString();

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
    writeState(ctx.casaDir(name), state);
    ctx.onStateChange?.();
    emitter.emit({ type: "stopped", name, exitCode: code ?? undefined });
  });

  // Wait for healthy — clean up on failure
  try {
    await waitForHealthy(port, token, ctx.healthTimeoutMs, name);
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

  const state: CasaState = {
    name, state: "running", pid: child.pid, port, workspacePath, startedAt,
    sandboxPlatform, sandboxMode,
  };
  writeState(casaDir, state);

  emitter.emit({ type: "spawned", name, pid: child.pid, port });

  return { name, state: "running", pid: child.pid, port, workspacePath, token, startedAt };
}
