import { mkdirSync, existsSync, writeFileSync, readFileSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { log } from "../shared/logger.js";
import { stringify as stringifyYaml } from "yaml";
import { getBot, setBot, removeBot } from "./store.js";
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
import { listHostBotEndpointCandidates } from "./resolve-endpoint.js";
import { IMAGE_NAME, REGISTRY_IMAGE, BOTS_BASE, HEALTH_CHECK_TIMEOUT_MS } from "./docker.constants.js";
import {
  docker, withBotLock, validateBotPath, inspectContainer, removeContainerOnly,
  isDockerError, buildBinds, buildContainerEnv, copyHostCodexAuth,
} from "./docker.utils.js";
import { getMutex } from "../shared/mutex.js";
import type { SpawnOptions, BotInfo } from "./docker.types.js";
export type { BotInfo } from "./docker.types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Read version from package.json at the installed package location
function getVersion(): string {
  try {
    const pkgPath = join(__dirname, "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    return pkg.version ?? "latest";
  } catch {
    return "latest";
  }
}

export async function ensureImage(): Promise<void> {
  const version = getVersion();
  const remoteTag = `${REGISTRY_IMAGE}:${version}`;

  try {
    await docker.getImage(IMAGE_NAME).inspect();
    log.info(`Image "${IMAGE_NAME}" already exists locally`);
    return;
  } catch {
    // Not found locally, proceed to pull or build
  }

  try {
    console.log(`Pulling ${remoteTag}...`);
    const stream = await docker.pull(remoteTag);
    await new Promise<void>((resolve, reject) => {
      docker.modem.followProgress(stream, (err: Error | null) => {
        if (err) reject(err);
        else resolve();
      }, (event: { status?: string; progress?: string }) => {
        if (event.status) {
          const line = event.progress ? `${event.status}: ${event.progress}` : event.status;
          process.stdout.write(`\r${line.slice(0, 80).padEnd(80)}`);
        }
      });
    });
    console.log();
    const pulled = docker.getImage(remoteTag);
    await pulled.tag({ repo: IMAGE_NAME, tag: "latest" });
    log.info(`Pulled and tagged ${remoteTag} as ${IMAGE_NAME}`);
    return;
  } catch (err) {
    log.warn("Could not pull pre-built image, building locally...", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  await buildImage();
}

export async function buildImage(): Promise<void> {
  console.log("Building mecha-agent Docker image locally (this may take a few minutes)...");
  const stream = await docker.buildImage(
    {
      context: join(__dirname, ".."),
      src: [
        "Dockerfile",
        "package.json",
        "package-lock.json",
        "tsconfig.json",
        "tsconfig.agent.json",
        "shared/",
        "agent/",
      ],
    },
    { t: IMAGE_NAME },
  );

  await new Promise<void>((resolve, reject) => {
    docker.modem.followProgress(stream, (err: Error | null) => {
      if (err) reject(err);
      else resolve();
    }, (event: { stream?: string }) => {
      if (event.stream) process.stdout.write(event.stream);
    });
  });
}

export async function spawn(config: BotConfig, botPath?: string): Promise<string> {
  return withBotLock(config.name, () => spawnUnlocked(config, botPath));
}

async function spawnUnlocked(config: BotConfig, botPath?: string, opts?: SpawnOptions): Promise<string> {
  try {
    const existingEntry = getBot(config.name);
    if (existingEntry && !opts?.allowRegistryEntry) {
      throw new BotAlreadyExistsError(config.name);
    }

    const existingContainer = await inspectContainer(config.name);
    if (existingContainer) {
      if (opts?.replaceExisting) {
        await removeContainerOnly(config.name);
      } else {
        throw new BotAlreadyExistsError(config.name);
      }
    }

    const resolvedPath = validateBotPath(botPath ?? join(BOTS_BASE, config.name));
    // Migrate legacy directory names (v0.3.2 and earlier)
    for (const [oldName, newName] of [["home-dot-claude", ".claude"], ["home-dot-codex", ".codex"], ["home-workspace", "workspace"], ["sessions", "tasks"]] as const) {
      const oldPath = join(resolvedPath, oldName);
      const newPath = join(resolvedPath, newName);
      if (existsSync(oldPath) && !existsSync(newPath)) {
        renameSync(oldPath, newPath);
      }
    }
    for (const sub of ["tasks", "data", "logs", ".claude", ".codex", "tailscale", "workspace"]) {
      mkdirSync(join(resolvedPath, sub), { recursive: true });
    }

    const costsPath = join(resolvedPath, "costs.json");
    if (!existsSync(costsPath)) {
      writeFileSync(costsPath, "{}\n");
    }

    const configPath = join(resolvedPath, "bot.yaml");
    writeFileSync(configPath, stringifyYaml(config), { mode: 0o600 });

    const botToken = "mecha_" + randomBytes(24).toString("hex");
    const binds = buildBinds(resolvedPath, configPath, config);
    const env = buildContainerEnv(config, botToken);
    copyHostCodexAuth(resolvedPath);

    const exposedPorts: Record<string, object> = { "3000/tcp": {} };
    const portBindings: Record<string, Array<{ HostIp?: string; HostPort?: string }>> = {};
    if (config.expose) {
      portBindings["3000/tcp"] = [{ HostPort: String(config.expose) }];
    } else {
      portBindings["3000/tcp"] = [{ HostIp: "127.0.0.1", HostPort: "" }];
    }

    const container = await docker.createContainer({
      Image: IMAGE_NAME,
      name: `mecha-${config.name}`,
      Env: env,
      ExposedPorts: exposedPorts,
      Labels: {
        "mecha.bot": "true",
        "mecha.bot.name": config.name,
        "mecha.bot.model": config.model,
      },
      HostConfig: {
        Binds: binds,
        PortBindings: portBindings,
        RestartPolicy: { Name: "unless-stopped" },
      },
    });

    await container.start();

    let healthy = false;
    let delay = 200;
    const deadline = Date.now() + HEALTH_CHECK_TIMEOUT_MS;

    while (Date.now() < deadline) {
      const candidates = await listHostBotEndpointCandidates(config.name, { allowRemote: false });
      for (const candidate of candidates) {
        try {
          const resp = await fetch(`${candidate.baseUrl}/health`, { signal: AbortSignal.timeout(2000) });
          if (resp.ok) {
            healthy = true;
            break;
          }
        } catch (err) {
          if (Date.now() + delay >= deadline) {
            log.warn(`Health check failing for "${config.name}"`, {
              via: candidate.via,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }
      if (healthy) break;
      if (candidates.length === 0 && Date.now() + delay >= deadline) {
        log.warn(`Health check failing for "${config.name}"`, { error: "no reachable host endpoint candidates" });
      }
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, 1000);
    }

    if (!healthy) {
      const logStream = await container.logs({ stdout: true, stderr: true, tail: 20 });
      const redactedLogs = logStream.toString()
        .replace(/(ANTHROPIC_API_KEY|CLAUDE_CODE_OAUTH_TOKEN|MECHA_BOT_TOKEN|MECHA_TS_AUTH_KEY|MECHA_HEADSCALE_API_KEY|OPENAI_API_KEY|GEMINI_API_KEY|XAI_API_KEY)=[^\s]*/g, "$1=***")
        .slice(0, 4096);
      log.error("Container logs on health failure", { logs: redactedLogs });
      try {
        await container.stop({ t: 5 });
        await container.remove();
      } catch { /* best-effort cleanup */ }
      throw new ProcessHealthTimeoutError(config.name);
    }

    try {
      setBot(config.name, {
        path: resolvedPath,
        config: configPath,
        containerId: container.id,
        model: config.model,
        botToken,
        createdAt: new Date().toISOString(),
      });
    } catch (regErr) {
      // Registry write failed — tear down the orphaned container
      try { await container.stop({ t: 5 }); await container.remove(); } catch { /* best-effort */ }
      throw regErr;
    }

    return container.id;
  } catch (err) {
    if (err instanceof ProcessHealthTimeoutError) throw err;
    // Re-throw structured errors (config, auth, etc.) without wrapping
    if (err instanceof Error && err.constructor !== Error) throw err;
    throw new ProcessSpawnError(err instanceof Error ? err.message : String(err));
  }
}

export async function start(name: string): Promise<void> {
  await withBotLock(name, async () => {
    const entry = getBot(name);
    if (!entry?.config) {
      throw new BotNotFoundError(name);
    }

    const info = await inspectContainer(name);
    if (info) {
      if (info.State?.Running) {
        throw new BotAlreadyRunningError(name);
      }
      await docker.getContainer(`mecha-${name}`).start();
      return;
    }

    const config = loadBotConfig(entry.config);
    await spawnUnlocked(config, entry.path, { allowRegistryEntry: true });
  });
}

export async function stop(name: string): Promise<void> {
  const mutex = getMutex(`bot:${name}`);
  const release = await mutex.acquire();
  try {
    const container = docker.getContainer(`mecha-${name}`);
    await container.stop({ t: 10 });
  } catch (err) {
    if (isDockerError(err, "No such container") || isDockerError(err, "is not running")) {
      throw new BotNotRunningError(name);
    }
    throw err;
  } finally {
    release();
  }
}

export async function remove(name: string): Promise<void> {
  const mutex = getMutex(`bot:${name}`);
  const release = await mutex.acquire();
  try {
    const container = docker.getContainer(`mecha-${name}`);
    try {
      await container.stop({ t: 10 });
    } catch (err) {
      if (!isDockerError(err, "is not running") && !isDockerError(err, "No such container")) {
        log.warn(`Stop during remove for "${name}" failed`, { error: err instanceof Error ? err.message : String(err) });
      }
    }
    await container.remove();
    removeBot(name);
  } catch (err) {
    if (isDockerError(err, "No such container")) {
      removeBot(name);
      return;
    }
    throw err;
  } finally {
    release();
  }
}

export async function restart(name: string): Promise<string> {
  return withBotLock(name, async () => {
    const entry = getBot(name);
    if (!entry?.config) {
      throw new BotNotFoundError(name);
    }

    const config = loadBotConfig(entry.config);
    await removeContainerOnly(name);
    return await spawnUnlocked(config, entry.path, {
      allowRegistryEntry: true,
      replaceExisting: true,
    });
  });
}

export async function list(): Promise<BotInfo[]> {
  const containers = await docker.listContainers({
    all: true,
    filters: { label: ["mecha.bot=true"] },
  });

  return containers.map((c) => ({
    name: c.Labels["mecha.bot.name"] ?? c.Names[0]?.replace(/^\/mecha-/, "") ?? "unknown",
    status: c.State ?? "unknown",
    model: c.Labels["mecha.bot.model"] ?? "unknown",
    containerId: c.Id.slice(0, 12),
    ports: c.Ports?.map((p) => p.PublicPort ? `${p.PublicPort}→${p.PrivatePort}` : String(p.PrivatePort)).join(", ") ?? "",
    startedAt: c.State === "running" ? new Date(c.Created * 1000).toISOString() : undefined,
  }));
}

export async function logs(name: string, follow: boolean): Promise<void> {
  const container = docker.getContainer(`mecha-${name}`);
  if (follow) {
    const stream = await container.logs({
      stdout: true,
      stderr: true,
      follow: true as const,
      tail: 50,
    });
    stream.on("error", (err: Error) => {
      log.warn("Log stream error", { error: err.message });
    });
    stream.pipe(process.stdout);
    await new Promise(() => {}); // hang until ctrl-c
  } else {
    const buf = await container.logs({
      stdout: true,
      stderr: true,
      tail: 200,
    });
    process.stdout.write(buf);
  }
}

/** Run a command inside a bot's container using dockerode container.exec API (no shell). */
export async function runInContainer(
  name: string,
  command: string[],
  interactive: boolean,
): Promise<number> {
  const container = docker.getContainer(`mecha-${name}`);

  const e = await container.exec({
    Cmd: command,
    AttachStdout: true,
    AttachStderr: true,
    AttachStdin: interactive,
    Tty: interactive,
    User: "appuser",
  });

  const stream = await e.start({
    hijack: interactive,
    stdin: interactive,
  });

  if (interactive) {
    process.stdin.setRawMode?.(true);
    process.stdin.pipe(stream);
    stream.pipe(process.stdout);

    const cleanup = () => {
      process.stdin.setRawMode?.(false);
      process.stdin.unpipe(stream);
    };
    // Ensure terminal is restored on any exit path
    const sigHandler = () => { cleanup(); process.exit(130); };
    process.on("SIGINT", sigHandler);
    process.on("SIGTERM", sigHandler);

    try {
      await new Promise<void>((resolve) => {
        stream.on("end", resolve);
        stream.on("error", resolve);
      });
    } finally {
      cleanup();
      process.removeListener("SIGINT", sigHandler);
      process.removeListener("SIGTERM", sigHandler);
    }
  } else {
    container.modem.demuxStream(stream, process.stdout, process.stderr);
    await new Promise<void>((resolve) => {
      stream.on("end", resolve);
      stream.on("error", resolve);
    });
  }

  let exitCode = 0;
  try { exitCode = (await e.inspect()).ExitCode ?? 0; } catch { /* container may be gone */ }
  return exitCode;
}

export async function getContainerIp(name: string): Promise<string | undefined> {
  try {
    const container = docker.getContainer(`mecha-${name}`);
    const info = await container.inspect();
    return info.NetworkSettings.IPAddress || undefined;
  } catch (err) {
    log.warn(`getContainerIp("${name}") failed`, { error: err instanceof Error ? err.message : String(err) });
    return undefined;
  }
}
