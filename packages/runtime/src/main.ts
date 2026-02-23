/**
 * Runtime entrypoint — starts the Fastify runtime server.
 * Runs as a bare process (spawned by ProcessManager) or standalone.
 */
import { createServer } from "./server.js";
import { createDatabase, runMigrations } from "./db/sqlite.js";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import type { MechaId } from "@mecha/core";

// Ensure Claude onboarding flag exists in $HOME
const homeDir = process.env["HOME"] ?? process.cwd();
const claudeJson = join(homeDir, ".claude.json");
const claudeDir = join(homeDir, ".claude");
if (!existsSync(claudeJson)) {
  writeFileSync(claudeJson, '{"hasCompletedOnboarding": true}\n');
}
if (!existsSync(claudeDir)) {
  mkdirSync(claudeDir, { recursive: true });
}

const mechaId = process.env["MECHA_ID"] as MechaId;
if (!mechaId) {
  console.error("MECHA_ID environment variable is required");
  process.exit(1);
}

const port = Number(process.env["PORT"] ?? 3000);
const host = process.env["HOST"] ?? "127.0.0.1";

// Initialize SQLite database for session persistence
const workspace = process.env["MECHA_WORKSPACE"] ?? process.cwd();
const dbPath = process.env["MECHA_DB_PATH"] ?? join(workspace, ".mecha", "state.db");
mkdirSync(dirname(dbPath), { recursive: true });
const db = createDatabase(dbPath);
runMigrations(db);

// Agent is always registered; it returns 503 if Claude auth
// is not configured. Auth is via `claude setup-token` credentials
// persisted in the state volume, NOT via ANTHROPIC_API_KEY.
// API-key auth is disabled by default per product spec (§11.2).
const app = createServer({
  mechaId,
  version: process.env["MECHA_VERSION"] ?? "0.1.0",
  logger: true,
  authToken: process.env["MECHA_AUTH_TOKEN"],
  otp: process.env["MECHA_OTP"],
  db,
  agent: {
    workingDirectory: workspace,
    permissionMode: (process.env["MECHA_PERMISSION_MODE"] ?? "default") as "default" | "plan" | "full-auto",
  },
});

/* v8 ignore start */
app.addHook("onClose", async () => {
  db.close();
});
/* v8 ignore stop */

app.listen({ port, host }, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`Mecha runtime ${mechaId} listening on ${address}`);
});
