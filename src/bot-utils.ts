/**
 * Runtime-agnostic bot utilities.
 * Extracted from docker.utils.ts — used by both Docker and Native runtimes.
 */
import { realpathSync, existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import { getMutex } from "../shared/mutex.js";
import { ProcessSpawnError } from "../shared/errors.js";
import { loadCredentials } from "./auth.js";
import { stringify as stringifyYaml } from "yaml";

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
  return real;
}

// GitHub's SSH host keys
const GITHUB_KNOWN_HOSTS = [
  "github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl",
  "github.com ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBEmKSENjQEezOmxkZMy7opKgwFB9nkt5YRrYMjNuG5N87uRgg6CLrbo5wAdT/y6v0mKV0U2w0WZ2YB/++Tpockg=",
  "github.com ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQCj7ndNxQowgcQnjshcLrqPEiiphnt+VTTvDP6mHBL9j1aNUkY4Ue1gvwnGLVlOhGeYrnZaMgRK6+PKCUXaDbC7qtbW8gIkhL7aGCsOr/C56SJMy/BCZfxd1nWzAOxSDPgVsmerOBYfNqltV9/hWCqBywINIR+5dIg6JTJ72pcEpEjcYgXkE2YEFXV1JHnsKgbLWNlhScqb2UmyRkQyytRLtL+38TGxkxCflmO+5Z8CSSNY7GidjMIZ7Q4zMjA2n1nGrlTDkzwDCsw+wqFPGQA179cnfGWOWRVruj16z6XyvxvjJwbz0wQZ75XK5tKSb7FNyeIEs4TT4jk+S4dhPeAUC5y+bDYirYgM4GC7uEnztnZyaVWQ7B381AK4Qdrwt51ZqExKbQpTUNn+EjqoTwvqNj4kqx5QUCI0ThS/YkOxJCXmPUWZbhjpCg56i+2aB6CmK2JGhn57K5mj0MNdBXA4/WnwH6XoPWJzK5Nyu2zB3nAZp+S5hpQs+p1vN1/wsjk=",
].join("\n") + "\n";

export function ensureBotSshKey(resolvedPath: string, botName: string): string {
  const sshDir = join(resolvedPath, "ssh");
  const keyPath = join(sshDir, "id_ed25519");
  const pubPath = `${keyPath}.pub`;
  const configPath = join(sshDir, "config");
  const knownHostsPath = join(sshDir, "known_hosts");

  mkdirSync(sshDir, { recursive: true });

  if (!existsSync(keyPath)) {
    execFileSync("ssh-keygen", ["-t", "ed25519", "-f", keyPath, "-N", "", "-C", `${botName}@mecha`], { stdio: "pipe" });
  }

  if (!existsSync(pubPath)) {
    execFileSync("ssh-keygen", ["-y", "-f", keyPath], { stdio: ["pipe", "pipe", "pipe"] });
    const pub = execFileSync("ssh-keygen", ["-y", "-f", keyPath]).toString().trim();
    writeFileSync(pubPath, `${pub} ${botName}@mecha\n`, { mode: 0o644 });
  }

  if (!existsSync(configPath)) {
    const sshConfig = `Host github.com\n  StrictHostKeyChecking accept-new\n  UserKnownHostsFile ~/.ssh/known_hosts\n  IdentityFile ~/.ssh/id_ed25519\n`;
    writeFileSync(configPath, sshConfig, { mode: 0o600 });
  }

  if (!existsSync(knownHostsPath)) {
    writeFileSync(knownHostsPath, GITHUB_KNOWN_HOSTS, { mode: 0o644 });
  }

  chmodSync(sshDir, 0o700);
  chmodSync(keyPath, 0o600);

  return sshDir;
}

export function writeBotCredentials(resolvedPath: string, authProfile?: string): void {
  const creds = loadCredentials();
  const claudeCreds = authProfile
    ? creds.filter((c) => c.name === authProfile && (c.type === "api_key" || c.type === "oauth_token"))
    : creds.filter((c) => c.type === "api_key" || c.type === "oauth_token").slice(0, 1);
  const outPath = join(resolvedPath, "credentials.yaml");
  const content = stringifyYaml({ credentials: claudeCreds }, { lineWidth: 0 });
  writeFileSync(outPath, content, { mode: 0o600 });
  chmodSync(outPath, 0o600);
}

export function copyHostCodexAuth(resolvedPath: string): void {
  const hostCodexAuth = join(homedir(), ".codex", "auth.json");
  const botCodexAuth = join(resolvedPath, ".codex", "auth.json");
  if (process.env.MECHA_COPY_HOST_CODEX_AUTH === "1" && existsSync(hostCodexAuth) && !existsSync(botCodexAuth)) {
    writeFileSync(botCodexAuth, readFileSync(hostCodexAuth, "utf-8"), { mode: 0o600 });
  }
}
