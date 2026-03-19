/**
 * T22: ProcessManager routing tests
 * Run: npx tsx test/t22-process-manager.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { ensureMechaDir, setBot } = await import("../src/store.js");
const { getManager, getManagerForBot, listAllBots } = await import("../src/process-manager.js");

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>) {
  return (async () => {
    try {
      await fn();
      console.log(`  PASS  ${name}`);
      passed++;
    } catch (err) {
      console.log(`  FAIL  ${name}: ${err instanceof Error ? err.message : err}`);
      failed++;
    }
  })();
}

console.log("--- T22: ProcessManager Routing ---\n");

// T22.1 getManager("docker") returns docker adapter
await test("T22.1 getManager docker returns docker adapter", () => {
  const manager = getManager("docker");
  assert.equal(manager.runtime, "docker", "runtime should be docker");
});

// T22.2 getManager("native") returns native manager
await test("T22.2 getManager native returns native manager", () => {
  const manager = getManager("native");
  assert.equal(manager.runtime, "native", "runtime should be native");
});

// T22.3-5 require a temp MECHA_HOME
const origHome = process.env.MECHA_HOME;
const TMP = mkdtempSync(join(tmpdir(), "mecha-t22-"));
process.env.MECHA_HOME = TMP;
ensureMechaDir();

try {
  // T22.3 getManagerForBot returns docker for unknown bot (default)
  await test("T22.3 getManagerForBot returns docker for unknown bot", () => {
    const manager = getManagerForBot("unknown-bot-xyz");
    assert.equal(manager.runtime, "docker", "unknown bot should default to docker");
  });

  // T22.4 getManagerForBot returns correct runtime for registered bot
  await test("T22.4 getManagerForBot returns correct runtime for registered bot", () => {
    setBot("native-bot-test", {
      path: join(TMP, "bots", "native-bot-test"),
      runtime: "native",
      model: "sonnet",
    });
    const manager = getManagerForBot("native-bot-test");
    assert.equal(manager.runtime, "native", "should return native manager for native bot");

    setBot("docker-bot-test", {
      path: join(TMP, "bots", "docker-bot-test"),
      runtime: "docker",
      model: "sonnet",
    });
    const manager2 = getManagerForBot("docker-bot-test");
    assert.equal(manager2.runtime, "docker", "should return docker manager for docker bot");
  });

  // T22.5 listAllBots returns empty array when both runtimes have no bots
  await test("T22.5 listAllBots returns array gracefully", async () => {
    // listAllBots catches errors from both runtimes and returns whatever it can
    const bots = await listAllBots();
    assert.ok(Array.isArray(bots), "should return an array");
  });
} finally {
  if (origHome) process.env.MECHA_HOME = origHome;
  else delete process.env.MECHA_HOME;
  rmSync(TMP, { recursive: true, force: true });
}

console.log(`\n--- T22 Results: ${passed} passed, ${failed} failed ---`);
if (failed > 0) process.exit(1);
