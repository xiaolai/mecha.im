#!/usr/bin/env node
import { createGatewayServer } from "./gateway/server.js";
import { join } from "node:path";
import { homedir } from "node:os";
import { DEFAULTS } from "@mecha/core";

const dbPath = join(homedir(), DEFAULTS.HOME_DIR, "channels.db");
const port = Number(process.env["MECHA_GATEWAY_PORT"] ?? 7650);

const server = await createGatewayServer({ dbPath, port });

process.on("SIGINT", async () => {
  await server.stop();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  await server.stop();
  process.exit(0);
});

await server.start();
console.log(`Channel gateway listening on http://127.0.0.1:${port}`);
