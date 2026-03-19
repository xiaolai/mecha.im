/**
 * T24: Bot lifecycle lock tests
 * Run: npx tsx test/t24-bot-lifecycle-lock.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, existsSync, rmSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { withBotLifecycleLock } = await import("../src/bot-lifecycle-lock.js");

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

console.log("--- T24: Bot Lifecycle Lock ---\n");

const TMP = mkdtempSync(join(tmpdir(), "mecha-t24-"));

try {
  // T24.1 Lock acquired and released on success
  await test("T24.1 Lock acquired and released on success", async () => {
    const botPath = join(TMP, "bot-lock-1");
    mkdirSync(botPath, { recursive: true });
    const lockPath = join(botPath, ".lifecycle.lock");

    const result = await withBotLifecycleLock(botPath, () => {
      // Lock should be held during execution
      assert.ok(existsSync(lockPath), "lock dir should exist during execution");
      return 42;
    });

    assert.equal(result, 42, "should return the function result");
    assert.ok(!existsSync(lockPath), "lock dir should be removed after completion");
  });

  // T24.2 Lock released on sync error
  await test("T24.2 Lock released on sync error", async () => {
    const botPath = join(TMP, "bot-lock-2");
    mkdirSync(botPath, { recursive: true });
    const lockPath = join(botPath, ".lifecycle.lock");

    let caught: Error | null = null;
    try {
      // withBotLifecycleLock throws synchronously when fn() throws synchronously
      await withBotLifecycleLock(botPath, () => {
        throw new Error("sync boom");
      });
    } catch (err) {
      caught = err as Error;
    }
    assert.ok(caught, "should have thrown");
    assert.equal(caught!.message, "sync boom");
    assert.ok(!existsSync(lockPath), "lock should be released after sync error");
  });

  // T24.3 Lock released on async error
  await test("T24.3 Lock released on async error", async () => {
    const botPath = join(TMP, "bot-lock-3");
    mkdirSync(botPath, { recursive: true });
    const lockPath = join(botPath, ".lifecycle.lock");

    await assert.rejects(
      () => withBotLifecycleLock(botPath, async () => {
        await new Promise((r) => setTimeout(r, 10));
        throw new Error("async boom");
      }),
      { message: "async boom" },
    );
    assert.ok(!existsSync(lockPath), "lock should be released after async error");
  });

  // T24.4 Sequential lock calls succeed (lock released between calls)
  await test("T24.4 Sequential lock calls succeed", async () => {
    const botPath = join(TMP, "bot-lock-4");
    mkdirSync(botPath, { recursive: true });
    const lockPath = join(botPath, ".lifecycle.lock");

    const order: number[] = [];

    // First lock call
    await withBotLifecycleLock(botPath, () => {
      order.push(1);
    });
    assert.ok(!existsSync(lockPath), "lock released after first call");

    // Second lock call should succeed immediately (not blocked)
    await withBotLifecycleLock(botPath, () => {
      order.push(2);
    });
    assert.ok(!existsSync(lockPath), "lock released after second call");

    assert.deepEqual(order, [1, 2], "both calls should complete in order");
  });

  // T24.5 Stale lock (>60s old) is recovered
  await test("T24.5 Stale lock is recovered", async () => {
    const botPath = join(TMP, "bot-lock-5");
    mkdirSync(botPath, { recursive: true });
    const lockPath = join(botPath, ".lifecycle.lock");

    // Create a stale lock dir with old mtime
    mkdirSync(lockPath);
    const oldTime = new Date(Date.now() - 120_000); // 2 minutes ago
    utimesSync(lockPath, oldTime, oldTime);

    // Should recover the stale lock and succeed
    const result = await withBotLifecycleLock(botPath, () => "recovered");
    assert.equal(result, "recovered", "should recover from stale lock");
    assert.ok(!existsSync(lockPath), "lock should be released after recovery");
  });
} finally {
  rmSync(TMP, { recursive: true, force: true });
}

console.log(`\n--- T24 Results: ${passed} passed, ${failed} failed ---`);
if (failed > 0) process.exit(1);
