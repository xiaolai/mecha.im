#!/usr/bin/env node
import { createServer } from "./index.js";
import { parseServerEnv } from "./env.js";

/* v8 ignore start -- entrypoint validated via env tests */
let env: ReturnType<typeof parseServerEnv>;
try {
  env = parseServerEnv(process.env as Record<string, string | undefined>);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

let server: Awaited<ReturnType<typeof createServer>>;
try {
  server = await createServer(env);
  await server.listen({ port: env.port, host: env.host });
} catch (err) {
  console.error("Failed to start server:", err instanceof Error ? err.message : String(err));
  process.exit(1);
}

console.log(`mecha-server listening on ${env.host}:${env.port}`);
console.log(`  Signaling: ws://${env.host}:${env.port}/ws`);
console.log(`  Relay:     ws://${env.host}:${env.port}/relay?token=<token>`);
console.log(`  Health:    http://${env.host}:${env.port}/healthz`);

let shuttingDown = false;
function shutdown(exitCode = 0): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("Shutting down...");
  server.close().catch((err) => {
    console.error("Shutdown error:", err instanceof Error ? err.message : String(err));
  }).finally(() => process.exit(exitCode));
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

process.on("unhandledRejection", (reason) => {
  console.error(`[mecha-server] Unhandled rejection: ${reason instanceof Error ? (reason as Error).stack ?? (reason as Error).message : String(reason)}`);
  shutdown(1);
});

process.on("uncaughtException", (err) => {
  console.error(`[mecha-server] Uncaught exception: ${err.stack ?? err.message}`);
  shutdown(1);
});
/* v8 ignore stop */
