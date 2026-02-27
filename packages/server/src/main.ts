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

const server = await createServer(env);

await server.listen({ port: env.port, host: env.host });

console.log(`mecha-server listening on ${env.host}:${env.port}`);
console.log(`  Signaling: ws://${env.host}:${env.port}/ws`);
console.log(`  Relay:     ws://${env.host}:${env.port}/relay?token=<token>`);
console.log(`  Health:    http://${env.host}:${env.port}/healthz`);

function shutdown(): void {
  console.log("Shutting down...");
  server.close().then(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
/* v8 ignore stop */
