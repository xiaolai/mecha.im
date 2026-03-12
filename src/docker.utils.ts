import Docker from "dockerode";
import { realpathSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { getMutex } from "../shared/mutex.js";
import { ProcessSpawnError } from "../shared/errors.js";
import { resolveAuth, getCredential, getPassthroughCredentials } from "./auth.js";
import { getOrCreateFleetInternalSecret, readSettings } from "./store.js";
import type { BotConfig } from "./config.js";

const docker = new Docker();

export { docker };

export async function withBotLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const mutex = getMutex(`bot:${name}`);
  const release = await mutex.acquire();
  try {
    return await fn();
  } finally {
    release();
  }
}

export function validateBotPath(botPath: string): string {
  const resolved = resolve(botPath);
  let real: string;
  try {
    real = realpathSync(resolved);
  } catch {
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

export async function inspectContainer(name: string): Promise<Docker.ContainerInspectInfo | null> {
  try {
    return await docker.getContainer(`mecha-${name}`).inspect();
  } catch (err) {
    if (isDockerError(err, "No such container")) return null;
    throw err;
  }
}

export async function removeContainerOnly(name: string): Promise<void> {
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

export function isDockerError(err: unknown, pattern: string): boolean {
  const dockerErr = err as { statusCode?: number; reason?: string; message?: string };
  if (pattern === "No such container" && dockerErr.statusCode === 404) return true;
  if (pattern === "is not running" && dockerErr.statusCode === 304) return true;
  if (err instanceof Error) return err.message.includes(pattern);
  return String(err).includes(pattern);
}

/** Build container binds list from config and bot path */
export function buildBinds(resolvedPath: string, configPath: string, config: BotConfig): string[] {
  const binds = [
    `${realpathSync(resolvedPath)}:/state:rw`,
    `${realpathSync(configPath)}:/config/bot.yaml:ro`,
    `${realpathSync(join(resolvedPath, "dot-claude"))}:/home/appuser/.claude:rw`,
    `${realpathSync(join(resolvedPath, "dot-codex"))}:/home/appuser/.codex:rw`,
  ];
  if (config.workspace) {
    const wsPath = realpathSync(config.workspace);
    const mode = config.workspace_writable ? "rw" : "ro";
    binds.push(`${wsPath}:/home/appuser/workspace:${mode}`);
  }
  return binds;
}

/** Build container environment variables from config and auth */
export function buildContainerEnv(config: BotConfig, botToken: string): string[] {
  const auth = resolveAuth(config.auth);
  const env = [
    `S6_KEEP_ENV=1`,
    `${auth.env}=${auth.key}`,
    `MECHA_BOT_NAME=${config.name}`,
    `MECHA_BOT_TOKEN=${botToken}`,
    `MECHA_FLEET_INTERNAL_SECRET=${getOrCreateFleetInternalSecret()}`,
    `MECHA_WORKSPACE_CWD=${config.workspace ? "/home/appuser/workspace" : "/state/home-workspace"}`,
    `MECHA_ENABLE_PROJECT_SETTINGS=${config.workspace ? "1" : "0"}`,
  ];

  const passthrough = getPassthroughCredentials(["OPENAI_API_KEY", "GEMINI_API_KEY", "XAI_API_KEY"]);
  for (const pt of passthrough) env.push(`${pt.env}=${pt.key}`);
  if (!passthrough.some((p) => p.env === "OPENAI_API_KEY")) {
    const openaiKey = process.env.OPENAI_API_KEY;
    if (openaiKey) env.push(`OPENAI_API_KEY=${openaiKey}`);
  }

  if (config.tailscale) {
    if (config.tailscale.auth_key) {
      env.push(`MECHA_TS_AUTH_KEY=${config.tailscale.auth_key}`);
    } else if (config.tailscale.auth_key_profile) {
      const tsProfile = getCredential(config.tailscale.auth_key_profile);
      env.push(`MECHA_TS_AUTH_KEY=${tsProfile.key}`);
    }
    if (config.tailscale.login_server) {
      env.push(`MECHA_TS_LOGIN_SERVER=${config.tailscale.login_server}`);
    }
  }

  const settings = readSettings();
  if (settings.headscale_url) env.push(`MECHA_HEADSCALE_URL=${settings.headscale_url}`);
  if (settings.headscale_api_key) env.push(`MECHA_HEADSCALE_API_KEY=${settings.headscale_api_key}`);

  return env;
}

/** Copy host Codex auth to bot if opted in */
export function copyHostCodexAuth(resolvedPath: string): void {
  const hostCodexAuth = join(homedir(), ".codex", "auth.json");
  const botCodexAuth = join(resolvedPath, "dot-codex", "auth.json");
  if (process.env.MECHA_COPY_HOST_CODEX_AUTH === "1" && existsSync(hostCodexAuth) && !existsSync(botCodexAuth)) {
    writeFileSync(botCodexAuth, readFileSync(hostCodexAuth, "utf-8"), { mode: 0o600 });
  }
}
