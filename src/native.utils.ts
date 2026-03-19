import { readFileSync, writeFileSync, unlinkSync, createWriteStream, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { WriteStream } from "node:fs";
import { resolveAuth, getPassthroughCredentials, getCredential } from "./auth.js";
import { getOrCreateFleetInternalSecret, readSettings } from "./store.js";
import { writeBotCredentials } from "./bot-utils.js";
import { ProcessSpawnError } from "../shared/errors.js";
import type { BotConfig } from "./config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── PID file helpers ────────────────────────────────────────

export function writePidFile(botPath: string, pid: number): void {
  writeFileSync(join(botPath, "agent.pid"), `${pid}:${Date.now()}`);
}

export function readPidFile(botPath: string): number | null {
  try {
    const raw = readFileSync(join(botPath, "agent.pid"), "utf-8").trim();
    const pid = parseInt(raw.split(":")[0]!, 10);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

export function readPidFileWithTime(botPath: string): { pid: number; startTime: number } | null {
  try {
    const raw = readFileSync(join(botPath, "agent.pid"), "utf-8").trim();
    const parts = raw.split(":");
    const pid = parseInt(parts[0]!, 10);
    const startTime = parseInt(parts[1] ?? "0", 10);
    return Number.isFinite(pid) ? { pid, startTime } : null;
  } catch {
    return null;
  }
}

export function removePidFile(botPath: string): void {
  try { unlinkSync(join(botPath, "agent.pid")); } catch { /* ok */ }
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but we lack permission to signal it
    if ((err as NodeJS.ErrnoException).code === "EPERM") return true;
    return false;
  }
}

// ── Env builder ─────────────────────────────────────────────

export async function buildNativeEnv(config: BotConfig, botPath: string, botToken: string, port: number): Promise<Record<string, string>> {
  const auth = resolveAuth(config.auth);
  writeBotCredentials(botPath, config.auth);

  // Filter host env: strip mecha-internal secrets and undefined values
  const STRIP_FROM_CHILD = new Set([
    "MECHA_DASHBOARD_TOKEN", "MECHA_BOT_TOKEN", "MECHA_BOT_NAME",
    "MECHA_FLEET_INTERNAL_SECRET", "MECHA_PORT", "MECHA_STATE_DIR",
    "MECHA_CONFIG_PATH", "MECHA_URL",
  ]);
  const parentEnv = Object.fromEntries(
    Object.entries(process.env).filter(([k, v]) => v !== undefined && !STRIP_FROM_CHILD.has(k)),
  ) as Record<string, string>;

  const env: Record<string, string> = {
    ...parentEnv,
    [auth.env]: auth.key,
    MECHA_BOT_NAME: config.name,
    MECHA_BOT_TOKEN: botToken,
    MECHA_STATE_DIR: botPath,
    MECHA_CONFIG_PATH: join(botPath, "bot.yaml"),
    MECHA_PORT: String(port),
    MECHA_FLEET_INTERNAL_SECRET: getOrCreateFleetInternalSecret(),
    MECHA_WORKSPACE_CWD: config.workspace ?? join(botPath, "workspace"),
    MECHA_ENABLE_PROJECT_SETTINGS: config.workspace ? "1" : "0",
    MECHA_DASHBOARD_ROOT: join(__dirname, "..", "agent", "dashboard", "dist"),
  };

  // Stored passthrough credentials override host env
  const passthroughKeys = ["OPENAI_API_KEY", "GEMINI_API_KEY", "XAI_API_KEY"];
  const passthrough = getPassthroughCredentials(passthroughKeys);
  for (const pt of passthrough) env[pt.env] = pt.key;

  // Tailscale
  if (config.tailscale) {
    if (config.tailscale.auth_key) {
      env.MECHA_TS_AUTH_KEY = config.tailscale.auth_key;
    } else if (config.tailscale.auth_key_profile) {
      const tsProfile = getCredential(config.tailscale.auth_key_profile);
      env.MECHA_TS_AUTH_KEY = tsProfile.key;
    }
    if (config.tailscale.login_server) {
      env.MECHA_TS_LOGIN_SERVER = config.tailscale.login_server;
    }
  }

  const settings = readSettings();
  if (settings.headscale_url) env.MECHA_HEADSCALE_URL = settings.headscale_url;
  if (settings.headscale_api_key) env.MECHA_HEADSCALE_API_KEY = settings.headscale_api_key;

  // Fleet URL for fleet_control bots (no Docker gateway needed — localhost works)
  const permissions = (config as Record<string, unknown>).permissions as Record<string, unknown> | undefined;
  if (permissions?.fleet_control) {
    const { getDaemonUrl } = await import("./daemon.js");
    const daemonUrl = getDaemonUrl();
    if (daemonUrl) env.MECHA_FLEET_URL = daemonUrl;
  }

  return env;
}

// ── Log helpers ─────────────────────────────────────────────

export function openLogStream(botPath: string): WriteStream {
  const logDir = join(botPath, "logs");
  mkdirSync(logDir, { recursive: true });
  try {
    return createWriteStream(join(logDir, "agent.log"), { flags: "a" });
  } catch (err) {
    throw new ProcessSpawnError(`Cannot open log file in ${logDir}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
