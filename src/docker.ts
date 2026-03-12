import Docker from "dockerode";
import { mkdirSync, existsSync, realpathSync, writeFileSync, chmodSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
import { log } from "../shared/logger.js";
import { stringify as stringifyYaml } from "yaml";
import { getMutex } from "../shared/mutex.js";
import { getBot, getOrCreateFleetInternalSecret, setBot, removeBot, readSettings } from "./store.js";
import { resolveAuth, getAuthProfile } from "./auth.js";
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

const __dirname = dirname(fileURLToPath(import.meta.url));

const docker = new Docker();

const IMAGE_NAME = "mecha-agent";
const REGISTRY_IMAGE = "ghcr.io/xiaolai/mecha.im";
const BOTS_BASE = join(homedir(), ".mecha", "bots");

interface SpawnOptions {
  allowRegistryEntry?: boolean;
  replaceExisting?: boolean;
}

async function withBotLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const mutex = getMutex(`bot:${name}`);
  const release = await mutex.acquire();
  try {
    return await fn();
  } finally {
    release();
  }
}

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

  // Check if image already exists locally
  try {
    await docker.getImage(IMAGE_NAME).inspect();
    log.info(`Image "${IMAGE_NAME}" already exists locally`);
    return;
  } catch {
    // Not found locally, proceed to pull or build
  }

  // Try pulling pre-built image from registry
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
    // Tag as local IMAGE_NAME for container creation
    const pulled = docker.getImage(remoteTag);
    await pulled.tag({ repo: IMAGE_NAME, tag: "latest" });
    log.info(`Pulled and tagged ${remoteTag} as ${IMAGE_NAME}`);
    return;
  } catch (err) {
    log.warn("Could not pull pre-built image, building locally...", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Fallback: build locally
  await buildImage();
}

export async function buildImage(): Promise<void> {
  console.log("Building mecha-agent Docker image locally (this may take a few minutes)...");
  const stream = await docker.buildImage(
    {
      context: process.cwd(),
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

function validateBotPath(botPath: string): string {
  const resolved = resolve(botPath);
  // Follow symlinks to prevent escape from home directory
  let real: string;
  try {
    real = realpathSync(resolved);
  } catch {
    // Path doesn't exist yet — resolve the parent directory to catch parent symlink escapes
    const parent = join(resolved, "..");
    try {
      const realParent = realpathSync(parent);
      real = join(realParent, resolved.slice(parent.length));
    } catch {
      real = resolved;
    }
  }
  const home = homedir();
  if (real !== home && !real.startsWith(home + "/")) {
    throw new ProcessSpawnError(`Bot path "${real}" must be under your home directory`);
  }
  return resolved;
}

export async function spawn(config: BotConfig, botPath?: string): Promise<string> {
  return withBotLock(config.name, () => spawnUnlocked(config, botPath));
}

async function inspectContainer(name: string): Promise<Docker.ContainerInspectInfo | null> {
  try {
    return await docker.getContainer(`mecha-${name}`).inspect();
  } catch (err) {
    if (isDockerError(err, "No such container")) return null;
    throw err;
  }
}

async function removeContainerOnly(name: string): Promise<void> {
  const container = docker.getContainer(`mecha-${name}`);
  try {
    await container.stop({ t: 10 });
  } catch (err) {
    if (!isDockerError(err, "is not running") && !isDockerError(err, "No such container")) {
      throw err;
    }
  }

  try {
    await container.remove();
  } catch (err) {
    if (!isDockerError(err, "No such container")) {
      throw err;
    }
  }
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

    // Resolve and validate bot path
    const resolvedPath = validateBotPath(botPath ?? join(BOTS_BASE, config.name));
    mkdirSync(join(resolvedPath, "sessions"), { recursive: true });
    mkdirSync(join(resolvedPath, "data"), { recursive: true });
    mkdirSync(join(resolvedPath, "logs"), { recursive: true });
    mkdirSync(join(resolvedPath, "claude"), { recursive: true });
    mkdirSync(join(resolvedPath, "codex"), { recursive: true });
    mkdirSync(join(resolvedPath, "tailscale"), { recursive: true });
    mkdirSync(join(resolvedPath, "workspace"), { recursive: true });

    // Pre-create costs.json if missing
    const costsPath = join(resolvedPath, "costs.json");
    if (!existsSync(costsPath)) {
      writeFileSync(costsPath, "{}\n");
    }

    // Write config with restrictive permissions
    const configPath = join(resolvedPath, "bot.yaml");
    writeFileSync(configPath, stringifyYaml(config), { mode: 0o600 });

    // Resolve auth
    const auth = resolveAuth(config.auth);

    // Build docker options
    const binds: string[] = [
      `${realpathSync(resolvedPath)}:/state:rw`,
      `${realpathSync(configPath)}:/config/bot.yaml:ro`,
      `${realpathSync(join(resolvedPath, "claude"))}:/home/appuser/.claude:rw`,
      `${realpathSync(join(resolvedPath, "codex"))}:/home/appuser/.codex:rw`,
    ];

    // Mount workspace if specified
    if (config.workspace) {
      const wsPath = realpathSync(config.workspace);
      const mode = config.workspace_writable ? "rw" : "ro";
      binds.push(`${wsPath}:/workspace:${mode}`);
    }

    // Auto-generate per-bot auth token
    const botToken = "mecha_" + randomBytes(24).toString("hex");

    const env = [
      `S6_KEEP_ENV=1`,
      `ANTHROPIC_API_KEY=${auth.apiKey}`,
      `MECHA_BOT_NAME=${config.name}`,
      `MECHA_BOT_TOKEN=${botToken}`,
      `MECHA_FLEET_INTERNAL_SECRET=${getOrCreateFleetInternalSecret()}`,
      `MECHA_WORKSPACE_CWD=${config.workspace ? "/workspace" : "/state/workspace"}`,
      `MECHA_ENABLE_PROJECT_SETTINGS=${config.workspace ? "1" : "0"}`,
    ];

    // OpenAI API key for Codex CLI (pass through from host if available)
    const openaiKey = process.env.OPENAI_API_KEY;
    if (openaiKey) {
      env.push(`OPENAI_API_KEY=${openaiKey}`);
    }

    // Copy host Codex auth only when the operator explicitly opts in.
    const hostCodexAuth = join(homedir(), ".codex", "auth.json");
    const botCodexAuth = join(resolvedPath, "codex", "auth.json");
    if (process.env.MECHA_COPY_HOST_CODEX_AUTH === "1" && existsSync(hostCodexAuth) && !existsSync(botCodexAuth)) {
      const authData = readFileSync(hostCodexAuth, "utf-8");
      writeFileSync(botCodexAuth, authData, { mode: 0o600 });
    }

    // Tailscale auth key
    if (config.tailscale) {
      if (config.tailscale.auth_key) {
        env.push(`MECHA_TS_AUTH_KEY=${config.tailscale.auth_key}`);
      } else if (config.tailscale.auth_key_profile) {
        const tsProfile = getAuthProfile(config.tailscale.auth_key_profile);
        env.push(`MECHA_TS_AUTH_KEY=${tsProfile.key}`);
      }
      if (config.tailscale.login_server) {
        env.push(`MECHA_TS_LOGIN_SERVER=${config.tailscale.login_server}`);
      }
    }

    // Headscale env vars for mecha_list tool
    const settings = readSettings();
    if (settings.headscale_url) {
      env.push(`MECHA_HEADSCALE_URL=${settings.headscale_url}`);
    }
    if (settings.headscale_api_key) {
      env.push(`MECHA_HEADSCALE_API_KEY=${settings.headscale_api_key}`);
    }

    const exposedPorts: Record<string, object> = { "3000/tcp": {} };
    const portBindings: Record<string, Array<{ HostIp?: string; HostPort?: string }>> = {};
    if (config.expose) {
      portBindings["3000/tcp"] = [{ HostPort: String(config.expose) }];
    } else {
      // Always publish a loopback-only management port so host features work on Colima/Docker Desktop.
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
    const deadline = Date.now() + 30_000;

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
      // Show logs on failure, then clean up orphaned container
      const logStream = await container.logs({ stdout: true, stderr: true, tail: 20 });
      // Redact potential secrets before truncating to avoid splitting a secret at the boundary
      const redactedLogs = logStream.toString()
        .replace(/(ANTHROPIC_API_KEY|MECHA_BOT_TOKEN|MECHA_TS_AUTH_KEY|MECHA_HEADSCALE_API_KEY)=[^\s]*/g, "$1=***")
        .slice(0, 4096);
      log.error("Container logs on health failure", { logs: redactedLogs });
      try {
        await container.stop({ t: 5 });
        await container.remove();
      } catch { /* best-effort cleanup */ }
      throw new ProcessHealthTimeoutError(config.name);
    }

    // Register
    setBot(config.name, {
      path: resolvedPath,
      config: configPath,
      containerId: container.id,
      model: config.model,
      botToken,
      createdAt: new Date().toISOString(),
    });

    return container.id;
  } catch (err) {
    if (err instanceof ProcessHealthTimeoutError) throw err;
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
      // Still clean registry
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

function isDockerError(err: unknown, pattern: string): boolean {
  // Check for Docker API status codes first, fall back to message matching
  const dockerErr = err as { statusCode?: number; reason?: string; message?: string };
  if (pattern === "No such container" && dockerErr.statusCode === 404) return true;
  if (pattern === "is not running" && dockerErr.statusCode === 304) return true;
  // Fallback to string matching for older dockerode versions
  if (err instanceof Error) return err.message.includes(pattern);
  return String(err).includes(pattern);
}

export interface BotInfo {
  name: string;
  status: string;
  model: string;
  containerId: string;
  ports: string;
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
