/**
 * T5: Server route tests (in-process Hono, no Docker needed)
 * Run: npx tsx test/t5-server-routes.ts
 */
import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";

const TMP = join(tmpdir(), `mecha-t5-${randomBytes(4).toString("hex")}`);
mkdirSync(join(TMP, "sessions"), { recursive: true });
mkdirSync(join(TMP, "logs"), { recursive: true });
process.env.MECHA_STATE_DIR = TMP;
process.env.MECHA_BOT_TOKEN = "test-token-12345";

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

console.log("--- T5: Server Routes ---\n");

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

// Helper to make requests to the Hono app
async function req(path: string, opts?: RequestInit) {
  return app.request(path, opts);
}

// T5.1 GET /health returns ok + name
await test("T5.1 GET /health ok + name", async () => {
  const res = await req("/health");
  assert.equal(res.status, 200);
  const data = await res.json() as { status: string; name: string };
  assert.equal(data.status, "ok");
  assert.equal(data.name, "test-bot");
});

// T5.2 API routes reject without auth
await test("T5.2 API rejects without auth", async () => {
  const res = await req("/api/status");
  assert.equal(res.status, 401);
});

// T5.3 API routes accept with auth
await test("T5.3 API accepts with auth", async () => {
  const res = await req("/api/status", {
    headers: { Authorization: "Bearer test-token-12345" },
  });
  assert.equal(res.status, 200);
});

// T5.4 POST /prompt rejects bad body
await test("T5.4 POST /prompt rejects bad body", async () => {
  const res = await req("/prompt", {
    method: "POST",
    headers: {
      Authorization: "Bearer test-token-12345",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ wrong_field: "oops" }),
  });
  assert.equal(res.status, 400);
});

// T5.5 GET /api/status shape
await test("T5.5 GET /api/status shape", async () => {
  const res = await req("/api/status", {
    headers: { Authorization: "Bearer test-token-12345" },
  });
  const data = await res.json() as Record<string, unknown>;
  assert.equal(data.name, "test-bot");
  assert.equal(data.state, "idle");
  assert.equal(typeof data.uptime, "number");
  assert.ok("current_task" in data);
  assert.ok("talking_to" in data);
  assert.ok("last_active" in data);
});

// T5.6 GET /api/config redacts secrets
await test("T5.6 GET /api/config shape", async () => {
  const res = await req("/api/config", {
    headers: { Authorization: "Bearer test-token-12345" },
  });
  const data = await res.json() as Record<string, unknown>;
  assert.equal(data.name, "test-bot");
  assert.equal(data.model, "sonnet");
  // Should NOT contain system prompt, auth, or token
  assert.equal("system" in data, false, "system prompt should not be exposed");
  assert.equal("auth" in data, false, "auth should not be exposed");
});

// T5.7 GET /api/costs shape
await test("T5.7 GET /api/costs shape", async () => {
  const res = await req("/api/costs", {
    headers: { Authorization: "Bearer test-token-12345" },
  });
  const data = await res.json() as Record<string, unknown>;
  assert.equal(typeof data.task, "number");
  assert.equal(typeof data.today, "number");
  assert.equal(typeof data.lifetime, "number");
});

// T5.8 GET /api/tasks shape
await test("T5.8 GET /api/tasks is array", async () => {
  const res = await req("/api/tasks", {
    headers: { Authorization: "Bearer test-token-12345" },
  });
  const data = await res.json();
  assert.ok(Array.isArray(data));
});

// T5.9 Dashboard path traversal blocked
// In dev (no /app/agent/dashboard/dist), falls through to SPA fallback → 404
// In container, the normalize() check catches it → 403
// Either 403 or 404 is acceptable; what matters is it's NOT 200
await test("T5.9 Dashboard path traversal blocked", async () => {
  const res = await req("/dashboard/../../etc/passwd");
  assert.ok(res.status === 403 || res.status === 404, `expected 403 or 404, got ${res.status}`);
  assert.notEqual(res.status, 200, "must not serve the file");
});

// T5.10 Prompt auth required
await test("T5.10 POST /prompt requires auth", async () => {
  const res = await req("/prompt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "hello" }),
  });
  assert.equal(res.status, 401);
});

// T5.11 GET /api/schedule returns array
await test("T5.11 GET /api/schedule", async () => {
  const res = await req("/api/schedule", {
    headers: { Authorization: "Bearer test-token-12345" },
  });
  const data = await res.json();
  assert.ok(Array.isArray(data));
});

rmSync(TMP, { recursive: true, force: true });

console.log(`\n--- T5 Results: ${passed} passed, ${failed} failed ---`);
if (failed > 0) process.exit(1);
