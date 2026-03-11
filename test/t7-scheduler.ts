/**
 * T7: Scheduler logic tests
 * Run: npx tsx test/t7-scheduler.ts
 */
import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
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

console.log("--- T7: Scheduler ---\n");

// Each test gets fresh state to avoid cross-contamination
function freshDir(): string {
  const dir = join(tmpdir(), `mecha-t7-${randomBytes(4).toString("hex")}`);
  mkdirSync(join(dir, "sessions"), { recursive: true });
  mkdirSync(join(dir, "logs"), { recursive: true });
  return dir;
}

// We must dynamically reimport to pick up changed MECHA_STATE_DIR
// But since modules cache, we'll just set the env once and accept shared state
// Alternative: test what we can without worrying about isolation
const TMP = freshDir();
process.env.MECHA_STATE_DIR = TMP;

const { Scheduler } = await import("../agent/scheduler.js");

// T7.1 Scheduler creates with correct entry
await test("T7.1 Scheduler status shape", () => {
  const sched = new Scheduler(
    [{ cron: "0 9 * * *", prompt: "Daily check" }],
    async () => {},
    () => false,
  );
  const status = sched.getStatus();
  assert.ok(status.length >= 1);
  const entry = status.find(s => s.prompt === "Daily check");
  assert.ok(entry, "entry found");
  assert.equal(entry!.cron, "0 9 * * *");
  assert.equal(entry!.status, "active");
  assert.ok(entry!.id, "has id");
  sched.stop();
});

// T7.2 Scheduler: manual trigger works
await test("T7.2 Manual trigger", async () => {
  const prompts: string[] = [];
  const sched = new Scheduler(
    [{ cron: "0 0 1 1 *", prompt: "Trigger me" }],
    async (p) => { prompts.push(p); },
    () => false,
  );
  const entry = sched.getStatus().find(s => s.prompt === "Trigger me");
  assert.ok(entry, "entry found");
  const ok = await sched.triggerNow(entry!.id);
  assert.ok(ok, "triggerNow returned true");
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(prompts.includes("Trigger me"), `handler called with: ${prompts}`);

  const after = sched.getStatus().find(s => s.id === entry!.id);
  // Note: getStatus() exposes runsToday, not runCount
  assert.ok(after!.runsToday >= 1, `runsToday: ${after!.runsToday}`);
  assert.equal(after!.lastResult, "success");
  sched.stop();
});

// T7.3 Scheduler: triggerNow with bad id returns false
await test("T7.3 Bad trigger ID", async () => {
  const sched = new Scheduler(
    [{ cron: "0 9 * * *", prompt: "unused" }],
    async () => {},
    () => false,
  );
  const ok = await sched.triggerNow("nonexistent12345");
  assert.equal(ok, false);
  sched.stop();
});

// T7.4 Scheduler: error counting
await test("T7.4 Error counting", async () => {
  const sched = new Scheduler(
    [{ cron: "0 0 1 1 *", prompt: "Error task" }],
    async () => { throw new Error("deliberate error"); },
    () => false,
  );
  const entry = sched.getStatus().find(s => s.prompt === "Error task");
  assert.ok(entry);
  await sched.triggerNow(entry!.id);
  await new Promise((r) => setTimeout(r, 300));

  const after = sched.getStatus().find(s => s.id === entry!.id);
  assert.ok(after!.consecutiveErrors >= 1, `errors: ${after!.consecutiveErrors}`);
  assert.equal(after!.lastResult, "error");
  sched.stop();
});

// T7.5 Scheduler: stable IDs based on cron+prompt
await test("T7.5 Stable IDs", () => {
  const sched1 = new Scheduler(
    [{ cron: "0 9 * * *", prompt: "Same task" }],
    async () => {},
    () => false,
  );
  const id1 = sched1.getStatus().find(s => s.prompt === "Same task")?.id;
  sched1.stop();

  const sched2 = new Scheduler(
    [{ cron: "0 9 * * *", prompt: "Same task" }],
    async () => {},
    () => false,
  );
  const id2 = sched2.getStatus().find(s => s.prompt === "Same task")?.id;
  sched2.stop();

  assert.equal(id1, id2, "same cron+prompt = same ID");
});

rmSync(TMP, { recursive: true, force: true });

console.log(`\n--- T7 Results: ${passed} passed, ${failed} failed ---`);
if (failed > 0) process.exit(1);
