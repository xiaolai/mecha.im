/**
 * T3: Agent module unit tests (session, costs, activity, event-log)
 * Run: npx tsx test/t3-agent-modules.ts
 */
import assert from "node:assert/strict";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";

const TMP = join(tmpdir(), `mecha-t3-${randomBytes(4).toString("hex")}`);
mkdirSync(join(TMP, "sessions"), { recursive: true });
mkdirSync(join(TMP, "logs"), { recursive: true });

// Patch PATHS before importing modules
process.env.MECHA_STATE_DIR = TMP;

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

console.log("--- T3: Agent Modules ---\n");

// We need to patch paths module before importing session/costs
// Since paths.ts reads MECHA_STATE_DIR at import time, we set env above

const { SessionManager } = await import("../agent/session.js");
const { CostTracker } = await import("../agent/costs.js");
const { ActivityTracker } = await import("../agent/activity.js");

// T3.1 Session: create task
await test("T3.1 Session create task", () => {
  const sm = new SessionManager();
  const task = sm.ensureActiveTask();
  assert.ok(task.id, "task has id");
  assert.equal(task.status, "active");
  assert.ok(task.created, "task has created timestamp");
  assert.equal(task.source, "interactive");
  assert.equal(typeof task.started_at, "string");
});

// T3.2 Session: capture sessionId
await test("T3.2 Session capture sessionId", () => {
  const sm = new SessionManager();
  sm.ensureActiveTask();
  sm.captureSessionId("test-session-123");
  const task = sm.getActiveTask();
  assert.equal(task?.session_id, "test-session-123");
});

// T3.3 Session: cost accumulation
await test("T3.3 Session cost accumulation", () => {
  const sm = new SessionManager();
  sm.ensureActiveTask();
  sm.addCost(0.001);
  sm.addCost(0.002);
  const task = sm.getActiveTask();
  assert.ok(Math.abs(task!.cost_usd - 0.003) < 0.0001, `cost: ${task!.cost_usd}`);
});

// T3.4 Session: newSession completes previous
await test("T3.4 Session newSession completes previous", () => {
  const sm = new SessionManager();
  const first = sm.ensureActiveTask();
  const { newTask, previousTask } = sm.newSession("done with first");
  assert.equal(previousTask?.id, first.id);
  assert.equal(previousTask?.status, "completed");
  assert.equal(previousTask?.summary, "done with first");
  assert.ok(previousTask?.ended_at, "completed task has ended_at");
  assert.notEqual(newTask.id, first.id);
  assert.equal(newTask.status, "active");
});

// T3.4b Session: begin isolated task records non-interactive source
await test("T3.4b Session begin isolated task", () => {
  const sm = new SessionManager();
  sm.ensureActiveTask();
  const task = sm.beginIsolatedTask("schedule");
  assert.equal(task.source, "schedule");
  assert.equal(task.status, "active");
});

// T3.5 Session: getResumeSessionId
await test("T3.5 Session getResumeSessionId", () => {
  const sm = new SessionManager();
  sm.ensureActiveTask();
  assert.equal(sm.getResumeSessionId(), undefined, "no session yet");
  sm.captureSessionId("sess-abc");
  assert.equal(sm.getResumeSessionId(), "sess-abc");
});

// T3.6 Session: listTasks returns newest first
await test("T3.6 Session listTasks newest first", () => {
  const sm = new SessionManager();
  sm.ensureActiveTask();
  sm.newSession("first done");
  sm.ensureActiveTask();
  const tasks = sm.listTasks();
  assert.ok(tasks.length >= 2);
  // Newest first — the active task should be first
  assert.equal(tasks[0].status, "active");
});

// T3.6b Session: markError sets error + ended_at
await test("T3.6b Session markError", () => {
  const sm = new SessionManager();
  sm.ensureActiveTask();
  const task = sm.markError("boom");
  assert.equal(task?.status, "error");
  assert.equal(task?.error, "boom");
  assert.ok(task?.ended_at, "error task has ended_at");
});

// T3.7 Costs: add + daily rollover
await test("T3.7 Costs add + rollover", () => {
  const ct = new CostTracker();
  ct.add(0.01);
  ct.add(0.02);
  const costs = ct.getCosts();
  assert.ok(Math.abs(costs.today - 0.03) < 0.001, `today: ${costs.today}`);
  assert.ok(costs.lifetime >= 0.03, `lifetime: ${costs.lifetime}`);
});

// T3.8 Costs: getCosts shape
await test("T3.8 Costs getCosts shape", () => {
  const ct = new CostTracker();
  const costs = ct.getCosts();
  assert.equal(typeof costs.task, "number");
  assert.equal(typeof costs.today, "number");
  assert.equal(typeof costs.lifetime, "number");
});

// T3.9 Activity: state transitions
await test("T3.9 Activity state transitions", () => {
  const at = new ActivityTracker();
  assert.equal(at.getState(), "idle");
  at.transition("thinking");
  assert.equal(at.getState(), "thinking");
  at.transition("idle");
  assert.equal(at.getState(), "idle");
});

// T3.10 Activity: event emission
await test("T3.10 Activity event emission", async () => {
  const at = new ActivityTracker();
  let emitted: unknown = null;
  at.on("change", (data: unknown) => { emitted = data; });
  at.transition("thinking");
  assert.ok(emitted, "change event emitted");
  const data = emitted as { prev: string; state: string };
  assert.equal(data.prev, "idle");
  assert.equal(data.state, "thinking");
});

// T3.11 Activity: lastActive updates on non-idle
await test("T3.11 Activity lastActive tracking", () => {
  const at = new ActivityTracker();
  assert.equal(at.getLastActive(), null);
  at.transition("thinking");
  assert.ok(at.getLastActive(), "lastActive set after transition");
  const ts = at.getLastActive();
  at.transition("idle");
  // lastActive should still be set (it records last non-idle moment)
  assert.ok(at.getLastActive());
});

// Cleanup
rmSync(TMP, { recursive: true, force: true });

console.log(`\n--- T3 Results: ${passed} passed, ${failed} failed ---`);
if (failed > 0) process.exit(1);
