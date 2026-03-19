/**
 * T21: Native utilities unit tests
 * Run: npx tsx test/t21-native-utils.ts
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const {
  writePidFile,
  readPidFile,
  readPidFileWithTime,
  removePidFile,
  isProcessAlive,
  openLogStream,
} = await import("../src/native.utils.js");

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

console.log("--- T21: Native Utilities ---\n");

const TMP = mkdtempSync(join(tmpdir(), "mecha-t21-"));

try {
  // T21.1 writePidFile + readPidFile roundtrip
  await test("T21.1 writePidFile + readPidFile roundtrip", () => {
    const botPath = join(TMP, "bot1");
    mkdirSync(botPath, { recursive: true });
    writePidFile(botPath, 12345);
    const pid = readPidFile(botPath);
    assert.equal(pid, 12345, "should read back the same PID");
  });

  // T21.2 readPidFileWithTime returns pid and startTime
  await test("T21.2 readPidFileWithTime returns pid and startTime", () => {
    const botPath = join(TMP, "bot2");
    mkdirSync(botPath, { recursive: true });
    const before = Date.now();
    writePidFile(botPath, 54321);
    const after = Date.now();
    const result = readPidFileWithTime(botPath);
    assert.ok(result, "should return a result");
    assert.equal(result!.pid, 54321, "pid should match");
    assert.ok(result!.startTime >= before, "startTime should be >= before");
    assert.ok(result!.startTime <= after, "startTime should be <= after");
  });

  // T21.3 readPidFile returns null for missing file
  await test("T21.3 readPidFile returns null for missing file", () => {
    const botPath = join(TMP, "nonexistent-bot");
    const pid = readPidFile(botPath);
    assert.equal(pid, null, "should return null for missing file");
  });

  // T21.4 readPidFile returns null for corrupt content
  await test("T21.4 readPidFile returns null for corrupt content", () => {
    const botPath = join(TMP, "bot-corrupt");
    mkdirSync(botPath, { recursive: true });
    writeFileSync(join(botPath, "agent.pid"), "not-a-number:garbage");
    const pid = readPidFile(botPath);
    assert.equal(pid, null, "should return null for corrupt content");
  });

  // T21.5 removePidFile removes the file
  await test("T21.5 removePidFile removes the file", () => {
    const botPath = join(TMP, "bot-remove");
    mkdirSync(botPath, { recursive: true });
    writePidFile(botPath, 99999);
    assert.ok(existsSync(join(botPath, "agent.pid")), "pid file should exist before removal");
    removePidFile(botPath);
    assert.ok(!existsSync(join(botPath, "agent.pid")), "pid file should not exist after removal");
  });

  // T21.6 removePidFile doesn't throw for missing file
  await test("T21.6 removePidFile doesn't throw for missing file", () => {
    const botPath = join(TMP, "bot-no-pid");
    mkdirSync(botPath, { recursive: true });
    // Should not throw
    removePidFile(botPath);
  });

  // T21.7 isProcessAlive returns true for current process
  await test("T21.7 isProcessAlive returns true for current process", () => {
    assert.equal(isProcessAlive(process.pid), true, "current process should be alive");
  });

  // T21.8 isProcessAlive returns false for non-existent PID
  await test("T21.8 isProcessAlive returns false for non-existent PID", () => {
    assert.equal(isProcessAlive(999999), false, "non-existent PID should not be alive");
  });

  // T21.9 openLogStream creates logs dir and writable stream
  await test("T21.9 openLogStream creates logs dir and writable stream", async () => {
    const botPath = join(TMP, "bot-logs");
    mkdirSync(botPath, { recursive: true });
    const stream = openLogStream(botPath);
    // logs dir should be created by openLogStream
    assert.ok(existsSync(join(botPath, "logs")), "logs dir should exist");
    // Write something to flush the file creation (createWriteStream is lazy)
    stream.write("test\n");
    await new Promise<void>((resolve, reject) => {
      stream.end(() => {
        try {
          assert.ok(existsSync(join(botPath, "logs", "agent.log")), "agent.log should exist after write");
          resolve();
        } catch (err) {
          reject(err);
        }
      });
    });
  });

  // T21.10 openLogStream throws on invalid path
  await test("T21.10 openLogStream throws on invalid path", () => {
    assert.throws(
      () => openLogStream("/nonexistent/path/that/cannot/be/created"),
      (err: unknown) => err instanceof Error,
      "should throw for invalid path",
    );
  });
} finally {
  rmSync(TMP, { recursive: true, force: true });
}

console.log(`\n--- T21 Results: ${passed} passed, ${failed} failed ---`);
if (failed > 0) process.exit(1);
