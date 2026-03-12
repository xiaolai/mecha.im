/**
 * T8: Docker integration tests (container lifecycle)
 * Run: npx tsx test/t8-docker.ts
 *
 * Prerequisites:
 *   - Docker running (colima start)
 *   - mecha-agent image built
 */
import assert from "node:assert/strict";
import Docker from "dockerode";
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import { randomBytes } from "node:crypto";
import { stringify as stringifyYaml } from "yaml";

// Colima socket path (macOS); fall back to default
const SOCKET = process.env.DOCKER_HOST?.replace("unix://", "")
  || join(homedir(), ".colima/default/docker.sock");
const docker = new Docker({ socketPath: SOCKET });

// Load API key from credentials.yaml or .env
import { loadApiKey } from "./load-api-key.js";
loadApiKey();
const IMAGE = "mecha-agent";
const TEST_NAME = `t8-${randomBytes(4).toString("hex")}`;
const CONTAINER_NAME = `mecha-${TEST_NAME}`;
// Use a random high port to avoid conflicts
const HOST_PORT = 19000 + Math.floor(Math.random() * 1000);

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

console.log("--- T8: Docker Integration ---\n");

// Setup: create temp state dir with config
// Must be under $HOME — colima VM only mounts home directory, not /var/folders
const TMP = join(homedir(), `.mecha-t8-${randomBytes(4).toString("hex")}`);
mkdirSync(join(TMP, "sessions"), { recursive: true });
mkdirSync(join(TMP, "logs"), { recursive: true });
mkdirSync(join(TMP, "home-dot-claude"), { recursive: true });
mkdirSync(join(TMP, "home-dot-codex"), { recursive: true });

const config = {
  name: TEST_NAME,
  system: "You are a test bot for T8 integration tests.",
  model: "sonnet",
};
writeFileSync(join(TMP, "bot.yaml"), stringifyYaml(config));

let container: Docker.Container | undefined;

// T8.1 Image exists
await test("T8.1 mecha-agent image exists", async () => {
  const image = docker.getImage(IMAGE);
  const info = await image.inspect();
  assert.ok(info.Id, "image has an ID");
  assert.ok(info.Size > 0, "image has non-zero size");
});

// T8.2 Container create
await test("T8.2 Container create", async () => {
  container = await docker.createContainer({
    Image: IMAGE,
    name: CONTAINER_NAME,
    Env: [
      "S6_KEEP_ENV=1",
      `ANTHROPIC_API_KEY=${process.env.ANTHROPIC_API_KEY}`,
      `MECHA_BOT_NAME=${TEST_NAME}`,
      `MECHA_BOT_TOKEN=test-token-${TEST_NAME}`,
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
  assert.ok(container.id, "container has an ID");
});

const BASE_URL = `http://localhost:${HOST_PORT}`;

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

// T8.3 Container start + health check
await test("T8.3 Container start + health check", async () => {
  assert.ok(container, "container exists");
  await container!.start();
  console.log(`    ... waiting for health at ${BASE_URL}/health`);

  const healthy = await waitForHealth();
  if (!healthy) {
    // Grab logs for diagnosis
    try {
      const logBuf = await container!.logs({ stdout: true, stderr: true, tail: 20 });
      console.log("    Container logs:", logBuf.toString().slice(0, 2000));
    } catch { /* ignore */ }
  }
  assert.ok(healthy, "container became healthy within 45s");

  const resp = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(2000) });
  const data = await resp.json() as { status: string; name: string };
  assert.equal(data.status, "ok");
  assert.equal(data.name, TEST_NAME);
});

// T8.4 API routes work through container
await test("T8.4 API status via container", async () => {
  const res = await fetch(`${BASE_URL}/api/status`, {
    headers: { Authorization: `Bearer test-token-${TEST_NAME}` },
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(res.status, 200);
  const data = await res.json() as Record<string, unknown>;
  assert.equal(data.name, TEST_NAME);
  assert.equal(data.state, "idle");
  assert.equal(typeof data.uptime, "number");
});

// T8.5 Auth rejection works in container
await test("T8.5 Auth rejection in container", async () => {
  const res = await fetch(`${BASE_URL}/api/status`, {
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(res.status, 401);
});

// T8.6 Container stop
await test("T8.6 Container stop", async () => {
  assert.ok(container, "container exists");
  await container!.stop({ t: 10 });
  const info = await container!.inspect();
  assert.equal(info.State.Running, false);
});

// T8.7 Container restart
await test("T8.7 Container restart", async () => {
  assert.ok(container, "container exists");
  await container!.start();
  const info = await container!.inspect();
  assert.equal(info.State.Running, true);

  const healthy = await waitForHealth();
  assert.ok(healthy, "container healthy after restart");
});

// Cleanup
if (container) {
  try {
    await container.stop({ t: 5 }).catch(() => {});
    await container.remove();
  } catch { /* best-effort */ }
}
rmSync(TMP, { recursive: true, force: true });

console.log(`\n--- T8 Results: ${passed} passed, ${failed} failed ---`);
if (failed > 0) process.exit(1);
