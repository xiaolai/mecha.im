import { serve } from "@hono/node-server";
import { readFileSync, existsSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { botConfigSchema } from "./types.js";
import { createApp } from "./server.js";
import { Scheduler } from "./scheduler.js";
import { createPtyManager } from "./pty-manager.js";
import { attachTerminalWs } from "./ws-terminal.js";
import { log } from "../shared/logger.js";

const CREDENTIALS_PATH = "/state/credentials.yaml";

// Crash handlers — log before dying so we know what happened
process.on("unhandledRejection", (reason) => {
  log.error("Unhandled rejection", { error: reason instanceof Error ? reason.message : String(reason) });
  process.exit(1);
});
process.on("uncaughtException", (err) => {
  log.error("Uncaught exception", { error: err.message, stack: err.stack });
  process.exit(1);
});

const DEFAULT_PORT = 3000;
const portEnv = process.env.MECHA_PORT;
let PORT = DEFAULT_PORT;
if (portEnv) {
  const parsed = parseInt(portEnv, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    log.error(`Invalid MECHA_PORT: "${portEnv}" (must be 1-65535)`);
    process.exit(1);
  }
  PORT = parsed;
}
const STATE_DIR = process.env.MECHA_STATE_DIR ?? "/state";
const CONFIG_PATH = process.env.MECHA_CONFIG_PATH ?? "/config/bot.yaml";

function loadConfig() {
  const name = process.env.MECHA_BOT_NAME;
  if (!name) {
    log.error("MECHA_BOT_NAME env var is required");
    process.exit(1);
  }

  // Re-resolve auth from credentials.yaml if available (supports runtime auth switching)
  // Read config.auth first to determine if credentials resolution is required
  let configAuth: string | undefined;
  try {
    const configRaw = readFileSync(CONFIG_PATH, "utf-8");
    const configParsed = parseYaml(configRaw) as { auth?: string };
    configAuth = configParsed.auth;
  } catch { /* config will be parsed again below */ }

  if (configAuth && existsSync(CREDENTIALS_PATH)) {
    // Profile is set — clear old env vars and resolve from credentials (fail fast on any error)
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    try {
      const credsRaw = readFileSync(CREDENTIALS_PATH, "utf-8");
      const credsParsed = parseYaml(credsRaw) as { credentials?: Array<{ name: string; type: string; env: string; key: string }> };
      const cred = credsParsed.credentials?.find((c) => c.name === configAuth);
      if (cred && (cred.type === "api_key" || cred.type === "oauth_token")) {
        process.env[cred.env] = cred.key;
        log.info(`Auth resolved from credentials.yaml: profile="${configAuth}" type=${cred.type}`);
      } else {
        log.error(`Auth profile "${configAuth}" not found or not a Claude auth credential in credentials.yaml`);
        process.exit(1);
      }
    } catch (err) {
      log.error(`Failed to resolve auth profile "${configAuth}" from credentials.yaml`, {
        error: err instanceof Error ? err.message : String(err),
      });
      process.exit(1);
    }
  }

  if (!process.env.ANTHROPIC_API_KEY && !process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    log.error("ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN env var is required");
    process.exit(1);
  }

  try {
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    const parsed = parseYaml(raw);
    const result = botConfigSchema.safeParse(parsed);
    if (!result.success) {
      log.error("Invalid bot config", { detail: JSON.stringify(result.error.format()) });
      process.exit(1);
    }
    return result.data;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      const result = botConfigSchema.safeParse({
        name,
        system: process.env.MECHA_SYSTEM_PROMPT ?? "You are a helpful assistant.",
        model: process.env.MECHA_MODEL ?? "sonnet",
      });
      if (!result.success) {
        log.error("Failed to build config from env", { detail: JSON.stringify(result.error.format()) });
        process.exit(1);
      }
      return result.data;
    }
    throw err;
  }
}

const config = loadConfig();
const startedAt = Date.now();

// Ensure state directories exist
mkdirSync(`${STATE_DIR}/sessions`, { recursive: true });
mkdirSync(`${STATE_DIR}/logs`, { recursive: true });

// PTY manager for interactive terminal sessions (created before app so it can be passed)
let ptyManager: ReturnType<typeof createPtyManager> | undefined;
try {
  const { createNodePtySpawn } = await import("./node-pty-adapter.js");
  ptyManager = createPtyManager({ spawnFn: createNodePtySpawn(), botConfig: config });
  log.info("PTY terminal support enabled (node-pty)");
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  log.info("PTY terminal support disabled", { reason: msg });
}

const { app, isBusy, handlePrompt, setScheduler, botToken } = createApp(config, startedAt, ptyManager);

// Start scheduler if configured
let scheduler: Scheduler | undefined;
if (config.schedule && config.schedule.length > 0) {
  scheduler = new Scheduler(config.schedule, handlePrompt, isBusy);
  setScheduler(scheduler);
  scheduler.start();
}

const server = serve({ fetch: app.fetch, port: PORT }, () => {
  log.info(`mecha-agent "${config.name}" listening on :${PORT}`);
});

// Attach WebSocket terminal server if PTY is available
if (ptyManager) {
  attachTerminalWs(server, ptyManager, botToken);
}

function gracefulShutdown(signal: string) {
  log.info(`${signal} received, shutting down...`);
  ptyManager?.shutdown();
  scheduler?.stop();
  const forceTimer = setTimeout(() => {
    log.warn("Graceful shutdown timeout, forcing exit");
    process.exit(1);
  }, 5000);
  forceTimer.unref();
  server.close(() => process.exit(0));
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
