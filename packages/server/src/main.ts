#!/usr/bin/env node
import { createServer, DEFAULT_CONFIG } from "./index.js";

const port = parseInt(process.env.PORT ?? String(DEFAULT_CONFIG.port), 10);
const host = process.env.HOST ?? DEFAULT_CONFIG.host;
const relayUrl = process.env.RELAY_URL ?? DEFAULT_CONFIG.relayUrl;

const server = await createServer({ port, host, relayUrl });

await server.listen({ port, host });

console.log(`mecha-server listening on ${host}:${port}`);
console.log(`  Signaling: ws://${host}:${port}/ws`);
console.log(`  Relay:     ws://${host}:${port}/relay?token=<token>`);
console.log(`  Health:    http://${host}:${port}/healthz`);

function shutdown(): void {
  console.log("Shutting down...");
  server.close().then(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
