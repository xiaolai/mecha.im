import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";

const TMP = join(tmpdir(), `mecha-t15-${randomBytes(4).toString("hex")}`);
mkdirSync(join(TMP, "sessions"), { recursive: true });
mkdirSync(join(TMP, "logs"), { recursive: true });
mkdirSync(join(TMP, "workspace"), { recursive: true });

process.env.MECHA_STATE_DIR = TMP;
process.env.MECHA_BOT_TOKEN = "test-bot-token";
process.env.MECHA_FLEET_INTERNAL_SECRET = "test-fleet-secret";
process.env.MECHA_WORKSPACE_CWD = "/state/workspace";
process.env.MECHA_ENABLE_PROJECT_SETTINGS = "0";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (err) {
    console.log(`  FAIL  ${name}: ${err instanceof Error ? err.message : err}`);
    failed++;
  }
}

console.log("--- T15: Interbot Auth ---\n");

const { createApp } = await import("../agent/server.js");

const config = {
  name: "test-bot",
  system: "You are a test bot",
  model: "sonnet",
  max_turns: 25,
  permission_mode: "default" as const,
  workspace_writable: false,
};

const { app } = createApp(config, Date.now());

await test("T15.1 Internal auth unlocks /prompt", async () => {
  const res = await app.request("/prompt", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-mecha-internal-auth": "test-fleet-secret",
    },
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 400);
});

await test("T15.2 Wrong internal auth is rejected", async () => {
  const res = await app.request("/prompt", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-mecha-internal-auth": "wrong-secret",
    },
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 401);
});

await test("T15.3 Internal auth does not unlock /api", async () => {
  const res = await app.request("/api/status", {
    headers: {
      "x-mecha-internal-auth": "test-fleet-secret",
    },
  });
  assert.equal(res.status, 401);
});

rmSync(TMP, { recursive: true, force: true });

console.log(`\n--- T15 Results: ${passed} passed, ${failed} failed ---`);
if (failed > 0) process.exit(1);
