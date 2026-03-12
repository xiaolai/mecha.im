/**
 * T2: Shared module unit tests
 * Run: npx tsx mecha.im.v3.testing/t2-shared.ts
 */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";

// Run: npx tsx test/t2-shared.ts (from project root)
const { Mutex, getMutex } = await import("../shared/mutex.js");
const { isValidName, parsePort, isValidUrl } = await import("../shared/validation.js");
const { atomicWriteJson, atomicWriteJsonAsync } = await import("../shared/atomic-write.js");
const { safeReadJson } = await import("../shared/safe-read.js");

const TMP = join(tmpdir(), `mecha-t2-${randomBytes(4).toString("hex")}`);
mkdirSync(TMP, { recursive: true });

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

console.log("--- T2: Shared Modules ---\n");

// T2.1 Mutex acquire/release
await test("T2.1 Mutex acquire/release", async () => {
  const m = new Mutex();
  assert.equal(m.isLocked, false);
  const release = await m.acquire();
  assert.equal(m.isLocked, true);
  release();
  assert.equal(m.isLocked, false);
});

// T2.2 Mutex tryAcquire (contention)
await test("T2.2 Mutex tryAcquire contention", async () => {
  const m = new Mutex();
  const release = await m.acquire();
  const second = m.tryAcquire();
  assert.equal(second, null, "tryAcquire should return null when locked");
  release();
  const third = m.tryAcquire();
  assert.notEqual(third, null, "tryAcquire should succeed after release");
  third!();
});

// T2.3 Mutex FIFO fairness
await test("T2.3 Mutex FIFO fairness", async () => {
  const m = new Mutex();
  const order: number[] = [];
  const release = await m.acquire();

  const p1 = m.acquire().then((r) => { order.push(1); r(); });
  const p2 = m.acquire().then((r) => { order.push(2); r(); });
  const p3 = m.acquire().then((r) => { order.push(3); r(); });

  // Let microtasks queue up
  await new Promise((r) => setTimeout(r, 10));
  release();
  await Promise.all([p1, p2, p3]);
  assert.deepEqual(order, [1, 2, 3], "FIFO order preserved");
});

// T2.4 getMutex keyed registry
await test("T2.4 getMutex keyed registry", async () => {
  const m1 = getMutex("test-key-a");
  const m2 = getMutex("test-key-a");
  assert.equal(m1, m2, "same key returns same mutex");
  const m3 = getMutex("test-key-b");
  assert.notEqual(m1, m3, "different key returns different mutex");
});

// T2.5 isValidName
await test("T2.5 isValidName", () => {
  assert.equal(isValidName("my-bot"), true);
  assert.equal(isValidName("bot123"), true);
  assert.equal(isValidName("a"), true);
  assert.equal(isValidName(""), false);
  assert.equal(isValidName("My-Bot"), false, "uppercase rejected");
  assert.equal(isValidName("bot_name"), false, "underscores rejected");
  assert.equal(isValidName("a".repeat(33)), false, "too long");
  assert.equal(isValidName("-start"), false, "leading hyphen");
});

// T2.6 parsePort
await test("T2.6 parsePort", () => {
  assert.equal(parsePort("3000"), 3000);
  assert.equal(parsePort("1"), 1);
  assert.equal(parsePort("65535"), 65535);
  assert.equal(parsePort("0"), undefined);
  assert.equal(parsePort("65536"), undefined);
  assert.equal(parsePort("abc"), undefined);
  assert.equal(parsePort(""), undefined);
});

// T2.7 isValidUrl
await test("T2.7 isValidUrl", () => {
  assert.equal(isValidUrl("https://example.com"), true);
  assert.equal(isValidUrl("http://localhost:8080"), true);
  assert.equal(isValidUrl("ftp://bad.com"), false);
  assert.equal(isValidUrl("not-a-url"), false);
});

// T2.8 Atomic write + read roundtrip
await test("T2.8 Atomic write + read roundtrip", async () => {
  const path = join(TMP, "atomic-test.json");
  const data = { foo: "bar", num: 42, nested: { a: [1, 2] } };
  atomicWriteJson(path, data);
  const content = JSON.parse(readFileSync(path, "utf-8"));
  assert.deepEqual(content, data);

  // Async variant
  const path2 = join(TMP, "atomic-test-async.json");
  await atomicWriteJsonAsync(path2, data);
  const content2 = JSON.parse(readFileSync(path2, "utf-8"));
  assert.deepEqual(content2, data);
});

// T2.9 Safe read: missing file
const { z } = await import("zod");

await test("T2.9 safeReadJson missing file", () => {
  const schema = z.object({ x: z.number() });
  const result = safeReadJson(join(TMP, "nonexistent.json"), "test", schema);
  assert.equal(result.ok, false);
  assert.equal((result as any).reason, "missing");
});

// T2.10 Safe read: corrupt JSON
await test("T2.10 safeReadJson corrupt JSON", () => {
  const path = join(TMP, "corrupt.json");
  writeFileSync(path, "{not valid json!!!}");
  const schema = z.object({ x: z.number() });
  const result = safeReadJson(path, "test", schema);
  assert.equal(result.ok, false);
  assert.equal((result as any).reason, "corrupt");
});

// T2.11 Safe read: schema mismatch returns "schema" reason
await test("T2.11 safeReadJson schema mismatch", () => {
  const path = join(TMP, "mismatch.json");
  writeFileSync(path, JSON.stringify({ x: "not a number" }));
  const schema = z.object({ x: z.number() });
  const result = safeReadJson(path, "test", schema);
  assert.equal(result.ok, false);
  assert.equal((result as any).reason, "schema");
});

// T2.12 Concurrent registry writes remain consistent
await test("T2.12 Concurrent registry writes", async () => {
  const { setBot, removeBot, getBot, ensureMechaDir } = await import("../src/store.js");
  const origHome = process.env.MECHA_HOME;
  const regTmp = join(tmpdir(), `mecha-t2-reg-${randomBytes(4).toString("hex")}`);
  process.env.MECHA_HOME = regTmp;
  ensureMechaDir();

  // Launch 10 concurrent setBot calls
  const names = Array.from({ length: 10 }, (_, i) => `bot-${i}`);
  await Promise.all(names.map((name) =>
    Promise.resolve().then(() => setBot(name, {
      path: `/tmp/${name}`,
      containerId: `cid-${name}`,
      model: "sonnet",
    })),
  ));

  // All 10 should be in the registry
  for (const name of names) {
    const entry = getBot(name);
    assert.ok(entry, `${name} should exist in registry`);
    assert.equal(entry!.model, "sonnet");
  }

  // Concurrent removes
  await Promise.all(names.map((name) =>
    Promise.resolve().then(() => removeBot(name)),
  ));

  for (const name of names) {
    assert.equal(getBot(name), undefined, `${name} should be removed`);
  }

  if (origHome) process.env.MECHA_HOME = origHome;
  else delete process.env.MECHA_HOME;
  rmSync(regTmp, { recursive: true, force: true });
});

// Cleanup
rmSync(TMP, { recursive: true, force: true });

console.log(`\n--- T2 Results: ${passed} passed, ${failed} failed ---`);
if (failed > 0) process.exit(1);
