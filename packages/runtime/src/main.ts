import { createServer } from "./server.js";
import { parseRuntimeEnv } from "./env.js";
import { createLogger, readBotConfig } from "@mecha/core";

/* v8 ignore start -- entrypoint validated via env.test.ts */
const log = createLogger("mecha:runtime");

let env: ReturnType<typeof parseRuntimeEnv>;
try {
  env = parseRuntimeEnv(process.env as Record<string, string | undefined>);
} catch (err) {
  log.error("Invalid environment", { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
}

// Read bot config for systemPrompt/appendSystemPrompt (R6-004)
const botConfig = env.MECHA_SANDBOX_ROOT ? readBotConfig(env.MECHA_SANDBOX_ROOT) : undefined;

const { app } = createServer({
  botName: env.MECHA_BOT_NAME,
  port: env.MECHA_PORT,
  authToken: env.MECHA_AUTH_TOKEN,
  projectsDir: env.MECHA_PROJECTS_DIR,
  workspacePath: env.MECHA_WORKSPACE,
  mechaDir: env.MECHA_DIR,
  botDir: env.MECHA_SANDBOX_ROOT,
  systemPrompt: botConfig?.systemPrompt,
  appendSystemPrompt: botConfig?.appendSystemPrompt,
});

app.listen({ port: env.MECHA_PORT, host: "127.0.0.1" }, (err) => {
  if (err) {
    log.error("Failed to start", { error: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  }
  log.info("bot listening", { bot: env.MECHA_BOT_NAME, port: env.MECHA_PORT });
});

let shuttingDown = false;
function gracefulShutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  const forceExit = setTimeout(() => process.exit(1), 10_000);
  if (forceExit.unref) forceExit.unref();
  app.close().finally(() => process.exit(0));
}
process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);

process.on("unhandledRejection", (reason) => {
  log.error("Unhandled rejection", { error: reason instanceof Error ? reason.stack ?? reason.message : String(reason) });
  app.close().finally(() => process.exit(1));
});

process.on("uncaughtException", (err) => {
  log.error("Uncaught exception", { error: err.stack ?? err.message });
  app.close().finally(() => process.exit(1));
});
/* v8 ignore stop */
