import { spawn as spawnChild, execFileSync } from "node:child_process";
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { randomBytes } from "node:crypto";
import { stringify as stringifyYaml } from "yaml";
import { getBot, setBot, removeBot, setBotDesiredState, listBots } from "./store.js";
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
import { withBotLifecycleLock } from "./bot-lifecycle-lock.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Find a free port by attempting to bind.
 * Note: inherent TOCTOU window between srv.close() and child's listen() —
 * the health check will catch port conflicts as a startup failure.
 */
async function pickPort(startPort = 3100): Promise<number> {
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

    // Cross-process lifecycle lock prevents CLI + daemon racing on same bot
    return withBotLifecycleLock(resolvedPath, async () => {
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
        logStream.end();
        throw new ProcessSpawnError("Failed to spawn agent process");
      }
      writePidFile(resolvedPath, pid);

      // Write provisional registry entry so the reconciler knows about this bot
      setBot(config.name, {
        path: resolvedPath,
        config: configPath,
        containerId: String(pid),
        pid,
        port,
        runtime: "native",
        model: config.model,
        botToken,
        createdAt: new Date().toISOString(),
        desired_state: "running",
      });

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
        logStream.end();
        try { process.kill(pid, "SIGTERM"); } catch { /* may already be dead */ }
        removePidFile(resolvedPath);
        removeBot(config.name);
        throw new ProcessHealthTimeoutError(config.name);
      }

      return String(pid);
    });
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

  // H-2: acquire mutex in stop() and restart()
  async stop(name: string): Promise<void> {
    const mutex = getMutex(`bot:${name}`);
    const release = await mutex.acquire();
    try {
      const entry = getBot(name);
      if (!entry) throw new BotNotFoundError(name);

      const pid = entry.pid ?? readPidFile(entry.path);
      if (!pid || !isProcessAlive(pid)) throw new BotNotRunningError(name);

      setBotDesiredState(name, "stopped");
      await killGracefully(pid);
      removePidFile(entry.path);
    } finally {
      release();
    }
  }

  async restart(name: string): Promise<string> {
    const mutex = getMutex(`bot:${name}`);
    const release = await mutex.acquire();
    try {
      const entry = getBot(name);
      if (!entry?.config) throw new BotNotFoundError(name);

      const pid = entry.pid ?? readPidFile(entry.path);
      if (pid && isProcessAlive(pid)) {
        await killGracefully(pid);
        removePidFile(entry.path);
      }

      const config = loadBotConfig(entry.config);
      return await this._spawn(config, entry.path, { allowRegistryEntry: true });
    } finally {
      release();
    }
  }

  // H-7: set desired_state before killing
  async remove(name: string): Promise<void> {
    const mutex = getMutex(`bot:${name}`);
    const release = await mutex.acquire();
    try {
      const entry = getBot(name);
      if (!entry) {
        removeBot(name);
        return;
      }

      setBotDesiredState(name, "removed");
      const pid = entry.pid ?? readPidFile(entry.path);
      if (pid) await killGracefully(pid);
      if (entry.path) removePidFile(entry.path);
      removeBot(name);
    } finally {
      release();
    }
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

  // H-5: clean up signal listeners; M-6: use tail command instead of readFileSync
  async logs(name: string, follow: boolean): Promise<void> {
    const entry = getBot(name);
    if (!entry?.path) throw new BotNotFoundError(name);
    const logPath = join(entry.path, "logs", "agent.log");

    if (follow) {
      const tail = spawnChild("tail", ["-f", logPath], { stdio: "inherit" });
      const cleanup = () => { tail.kill(); };
      process.once("SIGINT", cleanup);
      process.once("SIGTERM", cleanup);
      await new Promise<void>((resolve) => {
        tail.on("exit", () => {
          process.removeListener("SIGINT", cleanup);
          process.removeListener("SIGTERM", cleanup);
          resolve();
        });
      });
    } else {
      try {
        const output = execFileSync("tail", ["-200", logPath], { encoding: "utf-8", timeout: 5000 });
        process.stdout.write(output);
      } catch {
        console.log("No logs available");
      }
    }
  }
}
