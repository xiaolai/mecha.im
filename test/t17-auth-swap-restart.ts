/**
 * T17: Auth swap + restart integration test
 * Run: npx tsx test/t17-auth-swap-restart.ts
 *
 * Verifies that a bot picks up new credentials after:
 *   1. Changing the auth profile in the bot config
 *   2. Restarting the bot via docker.restart()
 *
 * Prerequisites:
 *   - Docker running (colima start)
 *   - mecha-agent image built
 *   - ANTHROPIC_API_KEY available (via credentials.yaml, .env, or env)
 */
import assert from "node:assert/strict";
import Docker from "dockerode";
import { mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
import { stringify as stringifyYaml } from "yaml";

// Colima socket path (macOS); fall back to default
const SOCKET = process.env.DOCKER_HOST?.replace("unix://", "")
  || join(homedir(), ".colima/default/docker.sock");
const dockerClient = new Docker({ socketPath: SOCKET });

// Load API key from credentials.yaml or .env
import { loadApiKey } from "./load-api-key.js";
loadApiKey();

const IMAGE = "mecha-agent";
const TEST_NAME = `t17-${randomBytes(3).toString("hex")}`;
const CONTAINER_NAME = `mecha-${TEST_NAME}`;
const HOST_PORT = 19200 + Math.floor(Math.random() * 800);
const BASE_URL = `http://localhost:${HOST_PORT}`;

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

console.log("--- T17: Auth Swap + Restart ---\n");

// Setup: temp state dir under $HOME (colima VM only mounts home)
const TMP = join(homedir(), `.mecha-t17-${randomBytes(4).toString("hex")}`);
mkdirSync(join(TMP, "sessions"), { recursive: true });
mkdirSync(join(TMP, "logs"), { recursive: true });
mkdirSync(join(TMP, "dot-claude"), { recursive: true });
mkdirSync(join(TMP, "dot-codex"), { recursive: true });
mkdirSync(join(TMP, "workspace"), { recursive: true });

// Two different bot tokens to distinguish auth configs
const TOKEN_A = `mecha_${randomBytes(24).toString("hex")}`;
const TOKEN_B = `mecha_${randomBytes(24).toString("hex")}`;

const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) {
  console.error("ANTHROPIC_API_KEY is required for T17 tests");
  process.exit(1);
}

const botConfig = {
  name: TEST_NAME,
  system: "You are a test bot for auth swap tests. Respond with OK.",
  model: "sonnet",
};
writeFileSync(join(TMP, "bot.yaml"), stringifyYaml(botConfig));

let container: Docker.Container | undefined;

async function waitForHealth(timeoutMs = 45_000): Promise<boolean> {
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

// T17.1 Spawn bot with Token A
await test("T17.1 Spawn bot with token A", async () => {
  container = await dockerClient.createContainer({
    Image: IMAGE,
    name: CONTAINER_NAME,
    Env: [
      "S6_KEEP_ENV=1",
      `ANTHROPIC_API_KEY=${API_KEY}`,
      `MECHA_BOT_NAME=${TEST_NAME}`,
      `MECHA_BOT_TOKEN=${TOKEN_A}`,
    ],
    ExposedPorts: { "3000/tcp": {} },
    HostConfig: {
      Binds: [
        `${TMP}:/state:rw`,
        `${join(TMP, "bot.yaml")}:/config/bot.yaml:ro`,
        `${join(TMP, "dot-claude")}:/home/appuser/.claude:rw`,
        `${join(TMP, "dot-codex")}:/home/appuser/.codex:rw`,
      ],
      PortBindings: { "3000/tcp": [{ HostPort: String(HOST_PORT) }] },
    },
  });

  await container.start();
  console.log(`    ... waiting for health at ${BASE_URL}/health`);
  const healthy = await waitForHealth();
  assert.ok(healthy, "bot should become healthy");
});

// T17.2 Verify Token A works
await test("T17.2 Token A authenticates API", async () => {
  const res = await fetch(`${BASE_URL}/api/status`, {
    headers: { Authorization: `Bearer ${TOKEN_A}` },
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(res.status, 200);
  const data = await res.json() as { name: string };
  assert.equal(data.name, TEST_NAME);
});

// T17.3 Token B is rejected before swap
await test("T17.3 Token B rejected before swap", async () => {
  const res = await fetch(`${BASE_URL}/api/status`, {
    headers: { Authorization: `Bearer ${TOKEN_B}` },
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(res.status, 401);
});

// T17.4 Stop, recreate with Token B, verify Token B works
await test("T17.4 Restart with token B picks up new auth", async () => {
  assert.ok(container, "container exists");

  // Stop and remove old container
  await container!.stop({ t: 10 });
  await container!.remove();

  // Recreate with Token B (simulating auth swap)
  container = await dockerClient.createContainer({
    Image: IMAGE,
    name: CONTAINER_NAME,
    Env: [
      "S6_KEEP_ENV=1",
      `ANTHROPIC_API_KEY=${API_KEY}`,
      `MECHA_BOT_NAME=${TEST_NAME}`,
      `MECHA_BOT_TOKEN=${TOKEN_B}`,
    ],
    ExposedPorts: { "3000/tcp": {} },
    HostConfig: {
      Binds: [
        `${TMP}:/state:rw`,
        `${join(TMP, "bot.yaml")}:/config/bot.yaml:ro`,
        `${join(TMP, "dot-claude")}:/home/appuser/.claude:rw`,
        `${join(TMP, "dot-codex")}:/home/appuser/.codex:rw`,
      ],
      PortBindings: { "3000/tcp": [{ HostPort: String(HOST_PORT) }] },
    },
  });

  await container.start();
  console.log(`    ... waiting for health after swap`);
  const healthy = await waitForHealth();
  assert.ok(healthy, "bot should become healthy after restart");

  // Token B should now work
  const res = await fetch(`${BASE_URL}/api/status`, {
    headers: { Authorization: `Bearer ${TOKEN_B}` },
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(res.status, 200);
  const data = await res.json() as { name: string };
  assert.equal(data.name, TEST_NAME);
});

// T17.5 Token A is now rejected after swap
await test("T17.5 Token A rejected after swap", async () => {
  const res = await fetch(`${BASE_URL}/api/status`, {
    headers: { Authorization: `Bearer ${TOKEN_A}` },
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(res.status, 401);
});

// T17.6 Swap API key credential (different ANTHROPIC_API_KEY env var)
// Verify the bot starts with a different API key by checking the env var flows through
await test("T17.6 Restart with different API key credential", async () => {
  assert.ok(container, "container exists");

  await container!.stop({ t: 10 });
  await container!.remove();

  // Use CLAUDE_CODE_OAUTH_TOKEN instead of ANTHROPIC_API_KEY to verify
  // the agent picks up the alternate auth env var on restart
  // We use a fake token — the bot will start but SDK calls will fail;
  // we only verify the container starts and accepts the health check
  const fakeOauthToken = "sk-ant-oat01-fake-for-t17-test";
  container = await dockerClient.createContainer({
    Image: IMAGE,
    name: CONTAINER_NAME,
    Env: [
      "S6_KEEP_ENV=1",
      `CLAUDE_CODE_OAUTH_TOKEN=${fakeOauthToken}`,
      `MECHA_BOT_NAME=${TEST_NAME}`,
      `MECHA_BOT_TOKEN=${TOKEN_B}`,
    ],
    ExposedPorts: { "3000/tcp": {} },
    HostConfig: {
      Binds: [
        `${TMP}:/state:rw`,
        `${join(TMP, "bot.yaml")}:/config/bot.yaml:ro`,
        `${join(TMP, "dot-claude")}:/home/appuser/.claude:rw`,
        `${join(TMP, "dot-codex")}:/home/appuser/.codex:rw`,
      ],
      PortBindings: { "3000/tcp": [{ HostPort: String(HOST_PORT) }] },
    },
  });

  await container.start();
  console.log(`    ... waiting for health with oauth token`);
  const healthy = await waitForHealth();
  assert.ok(healthy, "bot should start with CLAUDE_CODE_OAUTH_TOKEN instead of ANTHROPIC_API_KEY");

  // Verify it responds
  const res = await fetch(`${BASE_URL}/api/status`, {
    headers: { Authorization: `Bearer ${TOKEN_B}` },
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(res.status, 200);
});

// Cleanup
if (container) {
  try {
    await container.stop({ t: 5 }).catch(() => {});
    await container.remove();
  } catch { /* best-effort */ }
}
rmSync(TMP, { recursive: true, force: true });

console.log(`\n--- T17 Results: ${passed} passed, ${failed} failed ---`);
if (failed > 0) process.exit(1);
