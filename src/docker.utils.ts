import Docker from "dockerode";
import { realpathSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { ProcessSpawnError } from "../shared/errors.js";
import { resolveAuth, getCredential, getPassthroughCredentials } from "./auth.js";
import { getOrCreateFleetInternalSecret, readSettings } from "./store.js";
import type { BotConfig } from "./config.js";

// Re-export runtime-agnostic utilities for backward compatibility
export { withBotLock, validateBotPath, ensureBotSshKey, writeBotCredentials, copyHostCodexAuth } from "./bot-utils.js";

const docker = new Docker();

export { docker };

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

export function buildBinds(resolvedPath: string, configPath: string, config: BotConfig): string[] {
  const { writeBotCredentials } = require("./bot-utils.js") as typeof import("./bot-utils.js");
  const binds = [
    `${realpathSync(resolvedPath)}:/state:rw`,
    `${realpathSync(configPath)}:/config/bot.yaml:rw`,
    `${realpathSync(join(resolvedPath, ".claude"))}:/home/appuser/.claude:rw`,
    `${realpathSync(join(resolvedPath, ".codex"))}:/home/appuser/.codex:rw`,
  ];
  const sshDir = join(resolvedPath, "ssh");
  if (existsSync(join(sshDir, "id_ed25519"))) {
    binds.push(`${realpathSync(sshDir)}:/home/appuser/.ssh:ro`);
  }
  writeBotCredentials(resolvedPath, config.auth);
  if (config.workspace) {
    const wsPath = realpathSync(config.workspace);
    const home = homedir();
    if (!wsPath.startsWith(home + "/") && wsPath !== home) {
      throw new ProcessSpawnError(`Workspace path must be under home directory: ${wsPath}`);
    }
    const mode = config.workspace_writable ? "rw" : "ro";
    binds.push(`${wsPath}:/home/appuser/workspace:${mode}`);
  }
  return binds;
}

/** Build container environment variables from config and auth */
export async function buildContainerEnv(config: BotConfig, botToken: string): Promise<string[]> {
  const auth = resolveAuth(config.auth);
  const env = [
    `S6_KEEP_ENV=1`,
    `${auth.env}=${auth.key}`,
    `MECHA_BOT_NAME=${config.name}`,
    `MECHA_BOT_TOKEN=${botToken}`,
    `MECHA_FLEET_INTERNAL_SECRET=${getOrCreateFleetInternalSecret()}`,
    `MECHA_WORKSPACE_CWD=${config.workspace ? "/home/appuser/workspace" : "/state/workspace"}`,
    `MECHA_ENABLE_PROJECT_SETTINGS=${config.workspace ? "1" : "0"}`,
  ];

  const passthroughKeys = ["OPENAI_API_KEY", "GEMINI_API_KEY", "XAI_API_KEY"];
  const passthrough = getPassthroughCredentials(passthroughKeys);
  for (const pt of passthrough) env.push(`${pt.env}=${pt.key}`);
  for (const envKey of passthroughKeys) {
    if (!passthrough.some((p) => p.env === envKey)) {
      const val = process.env[envKey];
      if (val) env.push(`${envKey}=${val}`);
    }
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

  if ((config as Record<string, unknown>).permissions && ((config as Record<string, unknown>).permissions as Record<string, unknown>)?.fleet_control) {
    const { getDaemonUrl } = await import("./daemon.js");
    const daemonUrl = getDaemonUrl();
    if (daemonUrl) {
      const gatewayIp = await getDockerGatewayIp();
      const containerUrl = daemonUrl.replace("localhost", gatewayIp).replace("127.0.0.1", gatewayIp);
      env.push(`MECHA_FLEET_URL=${containerUrl}`);
    }
  }

  return env;
}

async function getDockerGatewayIp(): Promise<string> {
  try {
    const network = await docker.getNetwork("bridge").inspect();
    const gateway = network?.IPAM?.Config?.[0]?.Gateway;
    if (gateway) return gateway;
  } catch { /* fallback */ }
  return "host.docker.internal";
}
