/**
 * T23: Daemon reconciler building-block tests
 * Run: npx tsx test/t23-reconciler.ts
 *
 * The reconcile() function in daemon.ts is not exported, so we test the
 * building blocks it depends on: registry, getManagerForBot, listAllBots,
 * setBotDesiredState.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { ensureMechaDir, setBot, listBots, setBotDesiredState, getBot } = await import("../src/store.js");
const { getManagerForBot, listAllBots } = await import("../src/process-manager.js");

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

console.log("--- T23: Reconciler Building Blocks ---\n");

const origHome = process.env.MECHA_HOME;
const TMP = mkdtempSync(join(tmpdir(), "mecha-t23-"));
process.env.MECHA_HOME = TMP;
ensureMechaDir();

try {
  // T23.1 getManagerForBot dispatches correctly for docker vs native entries
  await test("T23.1 getManagerForBot dispatches docker vs native", () => {
    setBot("rec-docker", {
      path: join(TMP, "bots", "rec-docker"),
      runtime: "docker",
      model: "sonnet",
    });
    setBot("rec-native", {
      path: join(TMP, "bots", "rec-native"),
      runtime: "native",
      model: "sonnet",
    });

    const dockerMgr = getManagerForBot("rec-docker");
    assert.equal(dockerMgr.runtime, "docker", "docker bot should use docker manager");

    const nativeMgr = getManagerForBot("rec-native");
    assert.equal(nativeMgr.runtime, "native", "native bot should use native manager");
  });

  // T23.2 listAllBots merges results and handles errors gracefully
  await test("T23.2 listAllBots merges results gracefully", async () => {
    const bots = await listAllBots();
    assert.ok(Array.isArray(bots), "should return an array");
    // Even if Docker/native list fails (no Docker daemon, no native bots),
    // the function should not throw
  });

  // T23.3 Registry listBots returns entries with desired_state field
  await test("T23.3 listBots returns entries with desired_state", () => {
    setBot("state-bot-1", {
      path: join(TMP, "bots", "state-bot-1"),
      runtime: "native",
      model: "sonnet",
      desired_state: "running",
    });
    setBot("state-bot-2", {
      path: join(TMP, "bots", "state-bot-2"),
      runtime: "docker",
      model: "sonnet",
      desired_state: "stopped",
    });

    const bots = listBots();
    assert.equal(bots["state-bot-1"]?.desired_state, "running");
    assert.equal(bots["state-bot-2"]?.desired_state, "stopped");
  });

  // T23.4 setBotDesiredState updates correctly
  await test("T23.4 setBotDesiredState updates correctly", () => {
    setBot("desire-bot", {
      path: join(TMP, "bots", "desire-bot"),
      runtime: "native",
      model: "sonnet",
      desired_state: "running",
    });

    // Verify initial state
    let entry = getBot("desire-bot");
    assert.equal(entry?.desired_state, "running");

    // Update to stopped
    setBotDesiredState("desire-bot", "stopped");
    entry = getBot("desire-bot");
    assert.equal(entry?.desired_state, "stopped", "should be stopped after update");

    // Update to removed
    setBotDesiredState("desire-bot", "removed");
    entry = getBot("desire-bot");
    assert.equal(entry?.desired_state, "removed", "should be removed after update");
  });

  // T23.5 setBotDesiredState is no-op for non-existent bot
  await test("T23.5 setBotDesiredState no-op for non-existent bot", () => {
    // Should not throw
    setBotDesiredState("nonexistent-bot-xyz", "stopped");
    const entry = getBot("nonexistent-bot-xyz");
    assert.equal(entry, undefined, "non-existent bot should remain undefined");
  });
} finally {
  if (origHome) process.env.MECHA_HOME = origHome;
  else delete process.env.MECHA_HOME;
  rmSync(TMP, { recursive: true, force: true });
}

console.log(`\n--- T23 Results: ${passed} passed, ${failed} failed ---`);
if (failed > 0) process.exit(1);
