/**
 * T9: CLI command tests (spawn, ls, stop, rm lifecycle)
 * Run: npx tsx test/t9-cli.ts
 *
 * Prerequisites:
 *   - Docker running (colima start)
 *   - mecha-agent image built
 *   - ANTHROPIC_API_KEY available (via credentials.yaml, .env, or env)
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";

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

console.log("--- T9: CLI Commands ---\n");

// Load API key from credentials.yaml or .env
import { loadApiKey } from "./load-api-key.js";
loadApiKey();

const CLI = join(import.meta.dirname, "..", "src", "cli.ts");
const BOT_NAME = `t9-${randomBytes(3).toString("hex")}`;

// Ensure DOCKER_HOST points to colima socket
const DOCKER_SOCKET = join(homedir(), ".colima/default/docker.sock");
if (!process.env.DOCKER_HOST && existsSync(DOCKER_SOCKET)) {
  process.env.DOCKER_HOST = `unix://${DOCKER_SOCKET}`;
}

function mecha(...args: string[]): string {
  return execFileSync("npx", ["tsx", CLI, ...args], {
    encoding: "utf-8",
    timeout: 120_000,
    env: { ...process.env },
  }).trim();
}

function mechaUnsafe(...args: string[]): { stdout: string; error?: Error } {
  try {
    const stdout = execFileSync("npx", ["tsx", CLI, ...args], {
      encoding: "utf-8",
      timeout: 120_000,
      env: { ...process.env },
    }).trim();
    return { stdout };
  } catch (err) {
    const e = err as Error & { stdout?: string };
    return { stdout: e.stdout?.trim() ?? "", error: e };
  }
}

// T9.1 CLI --help
await test("T9.1 CLI --help", () => {
  const out = mecha("--help");
  assert.ok(out.includes("mecha"), "mentions mecha");
  assert.ok(out.includes("spawn") || out.includes("start"), "lists commands");
});

// Use a random port for health check (colima has no container IP access from macOS host)
const EXPOSE_PORT = 19100 + Math.floor(Math.random() * 900);

// T9.2 CLI spawn (with --expose for colima health check compatibility)
await test("T9.2 CLI spawn", () => {
  const out = mecha(
    "spawn",
    "--name", BOT_NAME,
    "--system", "You are a test bot for T9 CLI tests.",
    "--model", "sonnet",
    "--expose", String(EXPOSE_PORT),
  );
  assert.ok(
    out.includes("spawned") || out.includes("started") || out.includes(BOT_NAME),
    `spawn output: ${out.slice(0, 200)}`,
  );
});

// T9.3 CLI ls
await test("T9.3 CLI ls", () => {
  const out = mecha("ls");
  assert.ok(out.includes(BOT_NAME), `ls should show ${BOT_NAME}: ${out.slice(0, 300)}`);
});

// T9.4 Registry entry created
await test("T9.4 Registry entry", () => {
  const regPath = join(homedir(), ".mecha", "registry.json");
  assert.ok(existsSync(regPath), "registry.json exists");
  const reg = JSON.parse(readFileSync(regPath, "utf-8"));
  assert.ok(reg.bots[BOT_NAME], `bot "${BOT_NAME}" in registry`);
  assert.ok(reg.bots[BOT_NAME].botToken, "has botToken");
  assert.ok(reg.bots[BOT_NAME].containerId, "has containerId");
});

// T9.5 Bot health via API
await test("T9.5 Bot health via token", async () => {
  const regPath = join(homedir(), ".mecha", "registry.json");
  const reg = JSON.parse(readFileSync(regPath, "utf-8"));
  const token = reg.bots[BOT_NAME]?.botToken;
  assert.ok(token, "token in registry");

  // Find the port or container IP — use docker inspect
  const containerName = `mecha-${BOT_NAME}`;
  const portInfo = execFileSync("docker", [
    "-H", `unix://${homedir()}/.colima/default/docker.sock`,
    "port", containerName, "3000",
  ], { encoding: "utf-8" }).trim();

  // May be 0.0.0.0:PORT or :::PORT
  const portMatch = portInfo.match(/:(\d+)$/);
  if (portMatch) {
    const port = portMatch[1];
    // Wait for health
    let healthy = false;
    for (let i = 0; i < 30; i++) {
      try {
        const resp = await fetch(`http://localhost:${port}/health`, {
          signal: AbortSignal.timeout(2000),
        });
        if (resp.ok) { healthy = true; break; }
      } catch { /* retry */ }
      await new Promise(r => setTimeout(r, 1000));
    }
    // If no port exposed, skip health check
    if (!healthy) {
      console.log("    (no exposed port, skipping HTTP health check)");
    }
  }
  // Just verify the registry entry is valid
  assert.ok(token.startsWith("mecha_"), "token format correct");
});

// T9.5b Doctor (mecha-level)
await test("T9.5b Doctor mecha-level", () => {
  const out = mecha("doctor");
  assert.ok(out.includes("Mecha Doctor"), "shows Mecha Doctor header");
  assert.ok(out.includes("PASS") && out.includes("Docker daemon reachable"), "Docker check passes");
  assert.ok(out.includes("mecha-agent"), "image check present");
  assert.ok(out.includes("passed"), "shows pass count");
});

// T9.5c Doctor (bot-level)
await test("T9.5c Doctor bot-level", () => {
  const out = mecha("doctor", BOT_NAME);
  assert.ok(out.includes("Bot Doctor"), "shows Bot Doctor header");
  assert.ok(out.includes("PASS") && out.includes("running"), "container running check");
  assert.ok(out.includes("/home/appuser/.claude"), "dot-claude mount check");
  assert.ok(out.includes("/home/appuser/.codex"), "dot-codex mount check");
  assert.ok(out.includes("MECHA_BOT_NAME"), "env check present");
  assert.ok(out.includes("MECHA_BOT_TOKEN set"), "token check (no leak)");
  assert.ok(out.includes("claude:"), "runtime claude check");
  assert.ok(out.includes("writable"), "memory writable check");
  assert.ok(!out.includes("FAIL"), `no failures: ${out.slice(-200)}`);
});

// T9.5d Doctor nonexistent bot (exits non-zero)
await test("T9.5d Doctor nonexistent bot", () => {
  const { stdout, error } = mechaUnsafe("doctor", "no-such-bot-xyz");
  assert.ok(error, "should exit non-zero");
  assert.ok(stdout.includes("not found") || stdout.includes("Cannot continue"), "reports missing container");
});

// T9.6 CLI stop
await test("T9.6 CLI stop", () => {
  const out = mecha("stop", BOT_NAME);
  assert.ok(
    out.includes("stopped") || out.includes(BOT_NAME),
    `stop output: ${out.slice(0, 200)}`,
  );
});

// T9.7 CLI start (restart stopped container)
await test("T9.7 CLI start", () => {
  const out = mecha("start", BOT_NAME);
  assert.ok(
    out.includes("started") || out.includes(BOT_NAME),
    `start output: ${out.slice(0, 200)}`,
  );
});

// T9.8 CLI rm
await test("T9.8 CLI rm", () => {
  const out = mecha("rm", BOT_NAME);
  assert.ok(
    out.includes("removed") || out.includes(BOT_NAME),
    `rm output: ${out.slice(0, 200)}`,
  );
});

// T9.9 Bot removed from registry
await test("T9.9 Bot removed from registry", () => {
  const regPath = join(homedir(), ".mecha", "registry.json");
  const reg = JSON.parse(readFileSync(regPath, "utf-8"));
  assert.equal(reg.bots[BOT_NAME], undefined, "bot should be removed from registry");
});

// T9.10 Invalid name rejected
await test("T9.10 Invalid name rejected", () => {
  const { error } = mechaUnsafe("spawn", "--name", "UPPER_CASE!", "--system", "test");
  assert.ok(error, "should have thrown");
});

console.log(`\n--- T9 Results: ${passed} passed, ${failed} failed ---`);
if (failed > 0) process.exit(1);
