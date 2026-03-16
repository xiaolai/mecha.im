import Docker from "dockerode";
import { realpathSync, existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import { getMutex } from "../shared/mutex.js";
import { ProcessSpawnError } from "../shared/errors.js";
import { resolveAuth, getCredential, getPassthroughCredentials, loadCredentials } from "./auth.js";
import { getOrCreateFleetInternalSecret, readSettings } from "./store.js";
import { stringify as stringifyYaml } from "yaml";
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

// GitHub's SSH host keys (from https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints)
const GITHUB_KNOWN_HOSTS = [
  "github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl",
  "github.com ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBEmKSENjQEezOmxkZMy7opKgwFB9nkt5YRrYMjNuG5N87uRgg6CLrbo5wAdT/y6v0mKV0U2w0WZ2YB/++Tpockg=",
  "github.com ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQCj7ndNxQowgcQnjshcLrqPEiiphnt+VTTvDP6mHBL9j1aNUkY4Ue1gvwnGLVlOhGeYrnZaMgRK6+PKCUXaDbC7qtbW8gIkhL7aGCsOr/C56SJMy/BCZfxd1nWzAOxSDPgVsmerOBYfNqltV9/hWCqBywINIR+5dIg6JTJ72pcEpEjcYgXkE2YEFXV1JHnsKgbLWNlhScqb2UmyRkQyytRLtL+38TGxkxCflmO+5Z8CSSNY7GidjMIZ7Q4zMjA2n1nGrlTDkzwDCsw+wqFPGQA179cnfGWOWRVruj16z6XyvxvjJwbz0wQZ75XK5tKSb7FNyeIEs4TT4jk+S4dhPeAUC5y+bDYirYgM4GC7uEnztnZyaVWQ7B381AK4Qdrwt51ZqExKbQpTUNn+EjqoTwvqNj4kqx5QUCI0ThS/YkOxJCXmPUWZbhjpCg56i+2aB6CmK2JGhn57K5mj0MNdBXA4/WnwH6XoPWJzK5Nyu2zB3nAZp+S5hpQs+p1vN1/wsjk=",
].join("\n") + "\n";

/** Ensure a per-bot SSH key pair exists and is healthy. Returns the ssh dir path. */
export function ensureBotSshKey(resolvedPath: string, botName: string): string {
  const sshDir = join(resolvedPath, "ssh");
  const keyPath = join(sshDir, "id_ed25519");
  const pubPath = `${keyPath}.pub`;
  const configPath = join(sshDir, "config");
  const knownHostsPath = join(sshDir, "known_hosts");

  mkdirSync(sshDir, { recursive: true });

  // Generate key pair if private key is missing
  if (!existsSync(keyPath)) {
    execFileSync("ssh-keygen", ["-t", "ed25519", "-f", keyPath, "-N", "", "-C", `${botName}@mecha`], { stdio: "pipe" });
  }

  // Regenerate public key if missing
  if (!existsSync(pubPath)) {
    execFileSync("ssh-keygen", ["-y", "-f", keyPath], { stdio: ["pipe", "pipe", "pipe"] });
    const pub = execFileSync("ssh-keygen", ["-y", "-f", keyPath]).toString().trim();
    writeFileSync(pubPath, `${pub} ${botName}@mecha\n`, { mode: 0o644 });
  }

  // Ensure SSH config exists
  if (!existsSync(configPath)) {
    const sshConfig = `Host github.com\n  StrictHostKeyChecking accept-new\n  UserKnownHostsFile ~/.ssh/known_hosts\n  IdentityFile ~/.ssh/id_ed25519\n`;
    writeFileSync(configPath, sshConfig, { mode: 0o600 });
  }

  // Ensure known_hosts with GitHub's public keys
  if (!existsSync(knownHostsPath)) {
    writeFileSync(knownHostsPath, GITHUB_KNOWN_HOSTS, { mode: 0o644 });
  }

  // Normalize permissions every time
  chmodSync(sshDir, 0o700);
  chmodSync(keyPath, 0o600);

  return sshDir;
}

export function buildBinds(resolvedPath: string, configPath: string, config: BotConfig): string[] {
  const binds = [
    `${realpathSync(resolvedPath)}:/state:rw`,
    `${realpathSync(configPath)}:/config/bot.yaml:rw`,
    `${realpathSync(join(resolvedPath, "home-dot-claude"))}:/home/appuser/.claude:rw`,
    `${realpathSync(join(resolvedPath, "home-dot-codex"))}:/home/appuser/.codex:rw`,
  ];
  // Mount per-bot SSH keys if they exist (created by `mecha ssh-key <name>`)
  const sshDir = join(resolvedPath, "ssh");
  if (existsSync(join(sshDir, "id_ed25519"))) {
    binds.push(`${realpathSync(sshDir)}:/home/appuser/.ssh:ro`);
  }
  // Write filtered credentials (Claude auth profiles only) to bot state dir
  // This avoids mounting the full credentials store which contains unrelated secrets
  writeBotCredentials(resolvedPath, config.auth);
  if (config.workspace) {
    const wsPath = realpathSync(config.workspace);
    // Restrict workspace mount to home directory to prevent mounting system paths
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

  const passthroughKeys = ["OPENAI_API_KEY", "GEMINI_API_KEY", "XAI_API_KEY"];
  const passthrough = getPassthroughCredentials(passthroughKeys);
  for (const pt of passthrough) env.push(`${pt.env}=${pt.key}`);
  // Fallback: propagate host env vars for any key not found in stored credentials
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

  return env;
}

/**
 * Write a filtered credentials.yaml into the bot's state dir.
 * Only includes Claude auth profiles (api_key + oauth_token) — no unrelated secrets.
 * Lives in /state/ (rw mount) so it's always accessible and updatable.
 */
/** Write only the bot's assigned credential (not all profiles) to its state dir */
export function writeBotCredentials(resolvedPath: string, authProfile?: string): void {
  const creds = loadCredentials();
  // Only include the specific credential assigned to this bot, not all profiles
  const claudeCreds = authProfile
    ? creds.filter((c) => c.name === authProfile && (c.type === "api_key" || c.type === "oauth_token"))
    : creds.filter((c) => c.type === "api_key" || c.type === "oauth_token").slice(0, 1);
  const outPath = join(resolvedPath, "credentials.yaml");
  const content = stringifyYaml({ credentials: claudeCreds }, { lineWidth: 0 });
  writeFileSync(outPath, content, { mode: 0o600 });
}

/** Copy host Codex auth to bot if opted in */
export function copyHostCodexAuth(resolvedPath: string): void {
  const hostCodexAuth = join(homedir(), ".codex", "auth.json");
  const botCodexAuth = join(resolvedPath, "home-dot-codex", "auth.json");
  if (process.env.MECHA_COPY_HOST_CODEX_AUTH === "1" && existsSync(hostCodexAuth) && !existsSync(botCodexAuth)) {
    writeFileSync(botCodexAuth, readFileSync(hostCodexAuth, "utf-8"), { mode: 0o600 });
  }
}
