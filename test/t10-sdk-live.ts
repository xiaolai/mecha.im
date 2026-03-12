/**
 * T10: SDK query() live integration test
 * Run: npx tsx test/t10-sdk-live.ts
 *
 * Prerequisites:
 *   - Docker running (colima start)
 *   - mecha-agent image built
 *   - ANTHROPIC_API_KEY (real, valid key — this test costs money)
 *
 * This spawns a container and sends a real prompt through the /prompt API,
 * verifying the full SDK query() → Claude CLI → API roundtrip.
 */
import assert from "node:assert/strict";
import Docker from "dockerode";
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
import { stringify as stringifyYaml } from "yaml";

// Colima socket
const SOCKET = process.env.DOCKER_HOST?.replace("unix://", "")
  || join(homedir(), ".colima/default/docker.sock");
const docker = new Docker({ socketPath: SOCKET });

// Load API key from credentials.yaml or .env
import { loadApiKey } from "./load-api-key.js";
loadApiKey();

if (!process.env.ANTHROPIC_API_KEY) {
  console.log("SKIP: ANTHROPIC_API_KEY not available");
  process.exit(0);
}

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

console.log("--- T10: SDK Live Integration ---\n");

const IMAGE = "mecha-agent";
const TEST_NAME = `t10-${randomBytes(3).toString("hex")}`;
const HOST_PORT = 19200 + Math.floor(Math.random() * 800);
const BOT_TOKEN = `test-token-${TEST_NAME}`;
const BASE_URL = `http://localhost:${HOST_PORT}`;

// Setup
const TMP = join(homedir(), `.mecha-t10-${randomBytes(4).toString("hex")}`);
mkdirSync(join(TMP, "sessions"), { recursive: true });
mkdirSync(join(TMP, "logs"), { recursive: true });
mkdirSync(join(TMP, "home-workspace"), { recursive: true });
mkdirSync(join(TMP, "home-dot-claude"), { recursive: true });
mkdirSync(join(TMP, "home-dot-codex"), { recursive: true });

writeFileSync(join(TMP, "bot.yaml"), stringifyYaml({
  name: TEST_NAME,
  system: "You are a minimal test bot. Reply with exactly the text 'PONG' and nothing else when given the prompt 'PING'.",
  model: "sonnet",
  max_turns: 3,
  permission_mode: "bypassPermissions",
}));

let container: Docker.Container | undefined;

async function waitForHealth(timeoutMs = 60_000): Promise<boolean> {
  let delay = 500;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const resp = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(2000) });
      if (resp.ok) return true;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 2, 2000);
  }
  return false;
}

// T10.1 Start container
await test("T10.1 Start container", async () => {
  container = await docker.createContainer({
    Image: IMAGE,
    name: `mecha-${TEST_NAME}`,
    Env: [
      "S6_KEEP_ENV=1",
      `ANTHROPIC_API_KEY=${process.env.ANTHROPIC_API_KEY}`,
      `MECHA_BOT_NAME=${TEST_NAME}`,
      `MECHA_BOT_TOKEN=${BOT_TOKEN}`,
    ],
    ExposedPorts: { "3000/tcp": {} },
    HostConfig: {
      Binds: [
        `${TMP}:/state:rw`,
        `${join(TMP, "bot.yaml")}:/config/bot.yaml:ro`,
        `${join(TMP, "home-dot-claude")}:/home/appuser/.claude:rw`,
        `${join(TMP, "home-dot-codex")}:/home/appuser/.codex:rw`,
      ],
      PortBindings: { "3000/tcp": [{ HostPort: String(HOST_PORT) }] },
    },
  });
  await container.start();
  console.log(`    ... waiting for health at ${BASE_URL}`);
  const healthy = await waitForHealth();
  assert.ok(healthy, "container healthy");
});

// T10.2 Send prompt via SSE and collect response
await test("T10.2 Send prompt and get response", async () => {
  console.log("    ... sending PING prompt (may take 30-60s)");
  const res = await fetch(`${BASE_URL}/prompt`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${BOT_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message: "PING" }),
    signal: AbortSignal.timeout(120_000),
  });
  assert.equal(res.status, 200, `prompt response status: ${res.status}`);
  assert.ok(res.headers.get("content-type")?.includes("text/event-stream"), "SSE response");

  // Read SSE events
  const text = await res.text();
  console.log("    ... raw SSE response length:", text.length);
  const events = text.split("\n\n").filter(Boolean);
  console.log("    ... SSE events:", events.map(e => {
    const eventLine = e.split("\n").find(l => l.startsWith("event: "));
    return eventLine?.replace("event: ", "") ?? "unknown";
  }).join(", "));

  // If there's an error event, log it
  const errorEvent = events.find(e => e.includes("event: error"));
  if (errorEvent) {
    const dataLine = errorEvent.split("\n").find(l => l.startsWith("data: "));
    console.log("    ... ERROR event:", dataLine?.replace("data: ", ""));
  }

  // Find start event
  const startEvent = events.find(e => e.includes("event: start"));
  assert.ok(startEvent, "has start event");

  // Find done event
  const doneEvent = events.find(e => e.includes("event: done"));
  assert.ok(doneEvent, `has done event (got events: ${events.length}, raw: ${text.substring(0, 500)})`);

  // Parse done data
  const doneDataLine = doneEvent!.split("\n").find(l => l.startsWith("data: "));
  assert.ok(doneDataLine, "done event has data");
  const doneData = JSON.parse(doneDataLine!.replace("data: ", "")) as {
    cost_usd: number;
    session_id: string;
    duration_ms: number;
    success: boolean;
  };
  assert.ok(doneData.session_id, `has session_id: ${doneData.session_id}`);
  assert.equal(typeof doneData.cost_usd, "number", "has cost_usd");
  assert.equal(typeof doneData.duration_ms, "number", "has duration_ms");
  assert.equal(doneData.success, true, "success: true");

  console.log(`    cost=$${doneData.cost_usd.toFixed(4)}, duration=${doneData.duration_ms}ms`);
});

// T10.3 Costs tracked after prompt
await test("T10.3 Costs tracked", async () => {
  const res = await fetch(`${BASE_URL}/api/costs`, {
    headers: { Authorization: `Bearer ${BOT_TOKEN}` },
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(res.status, 200);
  const data = await res.json() as { task: number; today: number; lifetime: number };
  assert.ok(data.task > 0 || data.today > 0, `costs tracked: task=$${data.task}, today=$${data.today}`);
});

// T10.4 Task created
await test("T10.4 Task created", async () => {
  const res = await fetch(`${BASE_URL}/api/tasks`, {
    headers: { Authorization: `Bearer ${BOT_TOKEN}` },
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(res.status, 200);
  const tasks = await res.json() as Array<{ id: string; status: string }>;
  assert.ok(tasks.length >= 1, `has tasks: ${tasks.length}`);
});

// T10.5 Bot is idle after prompt completes
await test("T10.5 Bot idle after prompt", async () => {
  const res = await fetch(`${BASE_URL}/api/status`, {
    headers: { Authorization: `Bearer ${BOT_TOKEN}` },
    signal: AbortSignal.timeout(5000),
  });
  const data = await res.json() as { state: string };
  assert.equal(data.state, "idle");
});

// Capture container logs before cleanup if any tests failed
if (container && failed > 0) {
  try {
    const logs = await container.logs({ stdout: true, stderr: true, tail: 80 });
    const logText = typeof logs === "string" ? logs : logs.toString("utf-8");
    // Strip docker stream header bytes (8-byte prefix per line)
    const cleaned = logText.replace(/[\x00-\x08]/g, "").replace(/\r/g, "");
    console.log("\n--- Container logs (last 80 lines) ---");
    console.log(cleaned.slice(-4000));
    console.log("--- End container logs ---\n");
  } catch (e) {
    console.log("    (could not capture container logs:", e instanceof Error ? e.message : e, ")");
  }
}

// Cleanup
if (container) {
  try {
    await container.stop({ t: 5 }).catch(() => {});
    await container.remove();
  } catch { /* best-effort */ }
}
rmSync(TMP, { recursive: true, force: true });

console.log(`\n--- T10 Results: ${passed} passed, ${failed} failed ---`);
if (failed > 0) process.exit(1);
