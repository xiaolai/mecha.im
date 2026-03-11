/**
 * Integration test suite for mecha.
 *
 * Prerequisites:
 *   - Docker running (colima start)
 *   - ANTHROPIC_API_KEY set
 *   - mecha image built (mecha init)
 *
 * Run: npx tsx test/integration.test.ts
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import assert from "node:assert/strict";

const MECHA = join(import.meta.dirname, "..", "src", "cli.ts");
const BOT_NAME = "test-integration";

function mecha(...args: string[]): string {
  return execFileSync("npx", ["tsx", MECHA, ...args], {
    encoding: "utf-8",
    timeout: 120_000,
    env: { ...process.env },
  }).trim();
}

function getBotToken(name: string): string {
  const regPath = join(homedir(), ".mecha", "registry.json");
  const reg = JSON.parse(readFileSync(regPath, "utf-8"));
  return reg.bots?.[name]?.botToken ?? "";
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

async function waitFor(url: string, timeoutMs = 30_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (r.ok) return true;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function run() {
  console.log("--- Integration Test Suite ---\n");

  // Clean up from previous runs
  try { mecha("rm", BOT_NAME); } catch { /* ok */ }

  // 1. Init
  console.log("1. mecha init");
  const initDir = join(homedir(), ".mecha");
  if (!existsSync(initDir)) {
    mecha("init");
  }
  assert.ok(existsSync(join(initDir, "registry.json")), "registry.json exists");
  console.log("   PASS\n");

  // 2. Spawn
  console.log("2. mecha spawn (inline)");
  const spawnOut = mecha(
    "spawn",
    "--name", BOT_NAME,
    "--system", "You are a test bot. Always reply with exactly: MECHA_TEST_OK",
    "--expose", "13000",
  );
  assert.ok(spawnOut.includes("is running"), `spawn output: ${spawnOut}`);
  console.log("   PASS\n");

  // 3. Health check
  console.log("3. Health check");
  const healthy = await waitFor("http://localhost:13000/health");
  assert.ok(healthy, "health check passed");
  const healthResp = await fetch("http://localhost:13000/health");
  const healthData = await healthResp.json() as { name: string };
  assert.equal(healthData.name, BOT_NAME);
  console.log("   PASS\n");

  // 4. List
  console.log("4. mecha ls");
  const lsOut = mecha("ls");
  assert.ok(lsOut.includes(BOT_NAME), `ls output includes bot name`);
  assert.ok(lsOut.includes("running"), `ls shows running status`);
  console.log("   PASS\n");

  // 5. Chat
  console.log("5. mecha chat");
  const chatOut = mecha("chat", BOT_NAME, "Hello test");
  assert.ok(chatOut.length > 0, "chat returned a response");
  console.log(`   Response: ${chatOut.slice(0, 100)}...`);
  console.log("   PASS\n");

  // Get bot token for authenticated API calls
  const botToken = getBotToken(BOT_NAME);
  assert.ok(botToken.length > 0, "bot token exists in registry");
  const headers = authHeaders(botToken);

  // 6. API: tasks
  console.log("6. API: /api/tasks");
  const tasksResp = await fetch("http://localhost:13000/api/tasks", { headers });
  const tasks = await tasksResp.json() as unknown[];
  assert.ok(Array.isArray(tasks), "tasks is array");
  assert.ok(tasks.length > 0, "at least one task");
  console.log("   PASS\n");

  // 7. API: costs
  console.log("7. API: /api/costs");
  const costsResp = await fetch("http://localhost:13000/api/costs", { headers });
  const costs = await costsResp.json() as { lifetime: number };
  assert.ok(typeof costs.lifetime === "number", "lifetime cost is number");
  console.log(`   Lifetime cost: $${costs.lifetime.toFixed(4)}`);
  console.log("   PASS\n");

  // 8. API: status
  console.log("8. API: /api/status");
  const statusResp = await fetch("http://localhost:13000/api/status", { headers });
  const status = await statusResp.json() as { state: string; name: string };
  assert.equal(status.name, BOT_NAME);
  assert.equal(status.state, "idle");
  console.log("   PASS\n");

  // 9. API: config (redacted)
  console.log("9. API: /api/config");
  const configResp = await fetch("http://localhost:13000/api/config", { headers });
  const config = await configResp.json() as { name: string; auth?: string };
  assert.equal(config.name, BOT_NAME);
  console.log("   PASS\n");

  // 10. Stop
  console.log("10. mecha stop");
  const stopOut = mecha("stop", BOT_NAME);
  assert.ok(stopOut.includes("stopped"), `stop output: ${stopOut}`);
  console.log("   PASS\n");

  // 11. Start (resume)
  console.log("11. mecha start (resume)");
  const startOut = mecha("start", BOT_NAME);
  assert.ok(startOut.includes("is running"), `start output: ${startOut}`);
  const healthyAfterRestart = await waitFor("http://localhost:13000/health");
  assert.ok(healthyAfterRestart, "healthy after restart");
  console.log("   PASS\n");

  // 12. Session persistence
  console.log("12. Session persistence");
  const chatOut2 = mecha("chat", BOT_NAME, "What did we discuss?");
  assert.ok(chatOut2.length > 0, "resumed chat returned response");
  console.log("   PASS\n");

  // 13. Remove
  console.log("13. mecha rm");
  const rmOut = mecha("rm", BOT_NAME);
  assert.ok(rmOut.includes("removed"), `rm output: ${rmOut}`);
  console.log("   PASS\n");

  // 14. Auth
  console.log("14. mecha auth");
  mecha("auth", "add", "test-profile", "sk-ant-test-fake-key");
  const authList = mecha("auth", "list");
  assert.ok(authList.includes("test-profile"), "profile listed");
  // Cleanup
  const profilePath = join(homedir(), ".mecha", "auth", "test-profile.json");
  if (existsSync(profilePath)) rmSync(profilePath);
  console.log("   PASS\n");

  // 15. Token generation
  console.log("15. mecha token");
  const token = mecha("token");
  assert.ok(token.startsWith("mecha_"), `token format: ${token.slice(0, 10)}...`);
  assert.equal(token.length, 6 + 48, "token length (mecha_ + 24 hex bytes)");
  console.log("   PASS\n");

  console.log("--- All 15 tests passed ---");
}

run().catch((err) => {
  console.error("\nTEST FAILED:", err.message);
  // Cleanup
  try { mecha("rm", BOT_NAME); } catch { /* ok */ }
  process.exit(1);
});
