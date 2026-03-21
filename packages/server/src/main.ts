#!/usr/bin/env node
import { createServer } from "./index.js";
import { parseServerEnv } from "./env.js";
import { createLogger } from "@mecha/core";

/* v8 ignore start -- entrypoint validated via env tests */
const log = createLogger("mecha:server");

let env: ReturnType<typeof parseServerEnv>;
try {
  env = parseServerEnv(process.env as Record<string, string | undefined>);
} catch (err) {
  log.error("Invalid environment", { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
}

let server: Awaited<ReturnType<typeof createServer>>;
try {
  server = await createServer(env);
  await server.listen({ port: env.port, host: env.host });
} catch (err) {
  log.error("Failed to start server", { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
}

log.info("Server listening", {
  host: env.host,
  port: env.port,
  signaling: `ws://${env.host}:${env.port}/ws`,
  relay: `ws://${env.host}:${env.port}/relay`,
  health: `http://${env.host}:${env.port}/healthz`,
});

let shuttingDown = false;
function shutdown(exitCode = 0): void {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info("Shutting down");
  server.close().catch((err) => {
    log.error("Shutdown error", { error: err instanceof Error ? err.message : String(err) });
  }).finally(() => process.exit(exitCode));
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

process.on("unhandledRejection", (reason) => {
  log.error("Unhandled rejection", { error: reason instanceof Error ? (reason as Error).stack ?? (reason as Error).message : String(reason) });
  shutdown(1);
});

process.on("uncaughtException", (err) => {
  log.error("Uncaught exception", { error: err.stack ?? err.message });
  shutdown(1);
});
/* v8 ignore stop */
