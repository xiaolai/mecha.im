# Task Protocol Implementation Plan (Revised)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an A2A-inspired task lifecycle to mecha so bots can delegate long-running work with streaming progress, cancellation, and structured results.

**Architecture:** Tasks are JSON files at `~/.mecha/tasks/<id>.json`. Execution uses the existing `sdkChat` (which already supports `AbortSignal` + `ActivityEmitter`). Progress streams via the existing bot `/api/events` SSE endpoint — no new SSE infrastructure needed. The agent server gets `/tasks` routes. CLI-first: `mecha task` commands come before MCP tools.

**Tech Stack:** TypeScript, Fastify, Zod, vitest

**Spec:** `.claude/plans/inter-bot-communication-spec.md`

**Key design decisions from review:**
- **v1 is local-only** — no cross-node tasks, no webhooks (cut to simplify)
- **Execution via sdkChat** — which already has AbortSignal + ActivityEmitter
- **Progress via existing /api/events** — no file-polling SSE
- **Cancellation via AbortController** — registered per task ID
- **Results are text** — v1 stores response string, schema validation deferred to v2
- **Task ownership: target-local** — task file lives on the node that runs the bot

---

## Contracts (canonical, all layers use these)

**Task field names:**
- `target` — the bot that executes (not "bot")
- `source` — the bot@node that created the task
- `createdAt`, `updatedAt` — all timestamps are ISO 8601
- Route for cancel: `POST /tasks/:id/cancel` (not DELETE)

**TaskStatus:** `"pending" | "working" | "completed" | "failed" | "cancelled"`

(`rejected` cut from v1 — bots accept all tasks if ACL allows)

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `packages/core/src/task-types.ts` | Task, TaskStatus types + Zod schemas |
| `packages/core/src/task-storage.ts` | Read/write/list/clean task JSON files |
| `packages/agent/src/task-routes.ts` | Fastify routes for /tasks |
| `packages/agent/src/task-executor.ts` | Execute task via sdkChat with AbortController registry |
| `packages/service/src/task-ops.ts` | Service functions for CLI/MCP |
| `packages/runtime/src/mcp/task-tools.ts` | MCP tools: task_create, task_status, task_cancel, task_list |
| `packages/cli/src/commands/task.ts` | Parent command registration |
| `packages/cli/src/commands/task-list.ts` | `mecha task list` |
| `packages/cli/src/commands/task-show.ts` | `mecha task show <id>` |
| `packages/cli/src/commands/task-cancel.ts` | `mecha task cancel <id>` |
| `packages/cli/src/commands/task-create.ts` | `mecha task create <target> <message>` |

### Modified Files

| File | Change |
|------|--------|
| `packages/core/src/index.ts` | Re-export task types + storage |
| `packages/agent/src/server.ts` | Register task routes |
| `packages/agent/src/index.ts` | Re-export |
| `packages/service/src/index.ts` | Re-export task-ops |
| `packages/runtime/src/mcp/server.ts` | Register task tools |
| `packages/cli/src/program.ts` | Register `mecha task` group |

---

## Task 1: E2E Spike — Prove the Execution Model

**Goal:** Before writing any scaffolding, prove that a task can be created, executed via sdkChat, observed via activity stream, and cancelled via AbortController. This is a throwaway test.

**Files:**
- Create: `packages/integration/__tests__/task-spike.test.ts`

- [ ] **Step 1: Write the spike test**

```typescript
// packages/integration/__tests__/task-spike.test.ts
import { describe, it, expect, vi, afterAll, beforeAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

/**
 * Spike test: prove the execution model works.
 * 1. sdkChat can be called with an AbortController
 * 2. The AbortController actually stops execution
 * 3. Task state transitions can be tracked in a JSON file
 *
 * This test mocks sdkChat — real SDK tests are in integration.
 */
describe("task execution model spike", () => {
  it("executes a task and stores result", async () => {
    const tasksDir = mkdtempSync(join(tmpdir(), "spike-"));
    const taskId = `task-${randomUUID().slice(0, 8)}`;
    const taskFile = join(tasksDir, `${taskId}.json`);

    // Simulate: write pending task
    const task = {
      id: taskId, source: "coder@local", target: "analyst",
      status: "pending", message: "Review code",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(), artifacts: [],
    };
    writeFileSync(taskFile, JSON.stringify(task));

    // Simulate: execute with mock sdkChat
    const ac = new AbortController();
    const mockSdkChat = vi.fn().mockResolvedValue({
      response: "LGTM", sessionId: "s1", durationMs: 100, costUsd: 0.01,
    });

    // Update to working
    task.status = "working";
    task.updatedAt = new Date().toISOString();
    writeFileSync(taskFile, JSON.stringify(task));

    // Execute
    const result = await mockSdkChat("Review code", undefined, ac.signal);

    // Update to completed
    task.status = "completed";
    task.updatedAt = new Date().toISOString();
    (task as Record<string, unknown>).result = result.response;
    writeFileSync(taskFile, JSON.stringify(task));

    // Verify
    const loaded = JSON.parse(require("fs").readFileSync(taskFile, "utf-8"));
    expect(loaded.status).toBe("completed");
    expect(loaded.result).toBe("LGTM");

    rmSync(tasksDir, { recursive: true, force: true });
  });

  it("cancels a running task via AbortController", async () => {
    const ac = new AbortController();

    // Mock sdkChat that respects abort
    const mockSdkChat = vi.fn().mockImplementation(
      (_msg: string, _sid: undefined, signal: AbortSignal) =>
        new Promise((_, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );

    // Start execution
    const execPromise = mockSdkChat("long task", undefined, ac.signal);

    // Cancel after 10ms
    setTimeout(() => ac.abort(), 10);

    await expect(execPromise).rejects.toThrow("aborted");
  });
});
```

- [ ] **Step 2: Run the spike**

Run: `pnpm vitest run packages/integration/__tests__/task-spike.test.ts`
Expected: PASS — proves the model works

- [ ] **Step 3: Commit spike**

```bash
git add packages/integration/__tests__/task-spike.test.ts
git commit -m "spike: prove task execution model (sdkChat + AbortController + JSON state)"
```

---

## Task 2: Core Types + Storage (CLI-first foundation)

**Files:**
- Create: `packages/core/src/task-types.ts`
- Create: `packages/core/src/task-storage.ts`
- Create: `packages/core/__tests__/task-types.test.ts`
- Create: `packages/core/__tests__/task-storage.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write failing tests for types**

Test TaskStatusSchema (5 valid + 1 invalid), TaskSchema (valid task, optional fields, missing fields), TaskCreateInputSchema (valid, empty message rejected).

- [ ] **Step 2: Implement task-types.ts**

```typescript
// packages/core/src/task-types.ts
import { z } from "zod";

export const TaskStatusSchema = z.enum(["pending", "working", "completed", "failed", "cancelled"]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TaskArtifactSchema = z.object({
  type: z.string(),
  data: z.unknown(),
  createdAt: z.string(),
});
export type TaskArtifact = z.infer<typeof TaskArtifactSchema>;

export const TaskSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  status: TaskStatusSchema,
  message: z.string().min(1),
  result: z.string().optional(),
  error: z.string().optional(),
  sessionId: z.string().optional(),
  costUsd: z.number().optional(),
  durationMs: z.number().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  artifacts: z.array(TaskArtifactSchema),
});
export type Task = z.infer<typeof TaskSchema>;

export const TaskCreateInputSchema = z.object({
  target: z.string().min(1),
  message: z.string().min(1),
});
export type TaskCreateInput = z.infer<typeof TaskCreateInputSchema>;

export const TERMINAL_STATUSES: readonly TaskStatus[] = ["completed", "failed", "cancelled"];
```

- [ ] **Step 3: Write failing tests for storage**

Test writeTask/readTask round-trip, readTask returns undefined for missing, listTasks with status filter, deleteTask, cleanExpiredTasks.

- [ ] **Step 4: Implement task-storage.ts**

Same as previous plan but with v1 types (no priority, no schemas, result is string).

- [ ] **Step 5: Add re-exports, run tests, commit**

```bash
git commit -m "feat(core): add task types and storage for task protocol v1"
```

---

## Task 3: CLI Commands (CLI-first)

**Files:**
- Create: `packages/cli/src/commands/task.ts`
- Create: `packages/cli/src/commands/task-create.ts`
- Create: `packages/cli/src/commands/task-list.ts`
- Create: `packages/cli/src/commands/task-show.ts`
- Create: `packages/cli/src/commands/task-cancel.ts`
- Create: `packages/cli/__tests__/commands/task.test.ts`
- Modify: `packages/cli/src/program.ts`

CLI commands talk to the agent server via `AgentClient` (already exists in `packages/cli/src/client.ts`).

- [ ] **Step 1: Write failing tests for CLI commands**

Mock the HTTP calls (agent server not running in unit tests). Test:
- `mecha task create analyst "Review code"` → POST /tasks → shows task ID
- `mecha task list` → GET /tasks → table output
- `mecha task list --bot analyst --status working` → filtered
- `mecha task show <id>` → GET /tasks/:id → detailed output
- `mecha task cancel <id>` → POST /tasks/:id/cancel → confirmation

Follow existing CLI test patterns (vi.mock agent HTTP, test formatter output).

- [ ] **Step 2: Implement CLI commands**

`task-create.ts`:
```typescript
.command("create")
.argument("<target>", "bot name to run the task")
.argument("<message>", "task message/instruction")
.action(async (target, message, opts) => { ... })
```

Sends POST to `${agentBaseUrl}/tasks` with `{ target, message }`.

`task-list.ts`, `task-show.ts`, `task-cancel.ts`: GET/POST to agent server, format output.

- [ ] **Step 3: Register in program.ts, run tests, commit**

```bash
git commit -m "feat(cli): add mecha task create/list/show/cancel commands"
```

---

## Task 4: Agent Server Task Routes + Executor

**Files:**
- Create: `packages/agent/src/task-routes.ts`
- Create: `packages/agent/src/task-executor.ts`
- Create: `packages/agent/__tests__/task-routes.test.ts`
- Modify: `packages/agent/src/server.ts`

This is the core — routes that accept tasks, execute them via `forwardQueryToBot`, and track state.

- [ ] **Step 1: Write failing tests for task routes**

Use real Fastify injection (like existing server.test.ts). Mock `forwardQueryToBot`.

Tests:
- POST /tasks → 201, returns { id, status: "pending" }
- POST /tasks with invalid target → 400
- POST /tasks for non-existent bot → 404
- GET /tasks/:id → 200 with task
- GET /tasks/:id for missing → 404
- POST /tasks/:id/cancel on working task → 200
- POST /tasks/:id/cancel on completed task → 409
- GET /tasks → 200 with array

- [ ] **Step 2: Implement task-executor.ts**

```typescript
// packages/agent/src/task-executor.ts
import { writeTask, readTask, tasksDir } from "@mecha/core";
import type { Task } from "@mecha/core";
import { forwardQueryToBot, readBotConfig } from "@mecha/core";
import { join } from "node:path";

/** Registry of running task AbortControllers. */
const runningTasks = new Map<string, AbortController>();

/** Start executing a task asynchronously. Fire-and-forget. */
export function executeTask(mechaDir: string, task: Task): void {
  const ac = new AbortController();
  runningTasks.set(task.id, ac);

  // Update to working
  task.status = "working";
  task.updatedAt = new Date().toISOString();
  writeTask(tasksDir(mechaDir), task);

  // Execute in background
  void (async () => {
    try {
      const botDir = join(mechaDir, task.target);
      const config = readBotConfig(botDir);
      if (!config) throw new Error(`Bot config not found: ${task.target}`);

      const result = await forwardQueryToBot(
        config.port,
        config.token,
        task.message,
        undefined, // sessionId
        undefined, // requestId
      );

      if (ac.signal.aborted) return; // cancelled while executing

      task.status = "completed";
      task.result = result.text;
      task.sessionId = result.sessionId;
    } catch (err) {
      if (ac.signal.aborted) {
        task.status = "cancelled";
      } else {
        task.status = "failed";
        task.error = err instanceof Error ? err.message : String(err);
      }
    } finally {
      task.updatedAt = new Date().toISOString();
      writeTask(tasksDir(mechaDir), task);
      runningTasks.delete(task.id);
    }
  })();
}

/** Cancel a running task. Returns true if cancellation was initiated. */
export function cancelTask(taskId: string): boolean {
  const ac = runningTasks.get(taskId);
  if (!ac) return false;
  ac.abort();
  return true;
}

/** Check if a task is currently executing. */
export function isTaskRunning(taskId: string): boolean {
  return runningTasks.has(taskId);
}
```

- [ ] **Step 3: Implement task-routes.ts**

```typescript
// packages/agent/src/task-routes.ts — route registration function
// POST /tasks, GET /tasks, GET /tasks/:id, POST /tasks/:id/cancel
```

Each route:
- Validates auth (same preHandler as existing routes)
- ACL check on target bot
- Reads/writes via task-storage
- POST /tasks calls `executeTask()` and returns immediately

- [ ] **Step 4: Register in server.ts**

Add `registerTaskRoutes(app, { mechaDir, acl, authCtx })` call.

- [ ] **Step 5: Run tests, verify no regressions, commit**

```bash
pnpm vitest run --project agent
git commit -m "feat(agent): add /tasks routes with async execution and cancellation"
```

---

## Task 5: Service Layer

**Files:**
- Create: `packages/service/src/task-ops.ts`
- Create: `packages/service/__tests__/task-ops.test.ts`
- Modify: `packages/service/src/index.ts`

Service functions use `AgentClient` pattern (HTTP to agent server). Used by CLI commands.

Functions:
- `taskCreate(agentUrl, authCookie, input)` → POST /tasks
- `taskGet(agentUrl, authCookie, id)` → GET /tasks/:id
- `taskCancel(agentUrl, authCookie, id)` → POST /tasks/:id/cancel
- `taskList(agentUrl, authCookie, opts?)` → GET /tasks

- [ ] **Step 1-4: TDD cycle**

- [ ] **Step 5: Wire CLI commands to service layer (update task-create.ts etc.)**

- [ ] **Step 6: Run full CLI tests, commit**

```bash
git commit -m "feat(service): add task operation service functions"
```

---

## Task 6: MCP Tools

**Files:**
- Create: `packages/runtime/src/mcp/task-tools.ts`
- Create: `packages/runtime/__tests__/mcp/task-tools.test.ts`
- Modify: `packages/runtime/src/mcp/server.ts`

MCP tools for bots:
- `task_create(target, message)` → creates task on local agent server
- `task_status(taskId)` → reads task state
- `task_cancel(taskId)` → cancels task
- `task_list(target?, status?)` → lists tasks

Follow `packages/runtime/src/mcp/bus-tools.ts` pattern exactly.

- [ ] **Step 1-4: TDD cycle**

- [ ] **Step 5: Register in MCP server, commit**

```bash
git commit -m "feat(runtime): add task MCP tools (create, status, cancel, list)"
```

---

## Task 7: Integration Test

**Files:**
- Create: `packages/integration/__tests__/task-protocol.test.ts`
- Delete: `packages/integration/__tests__/task-spike.test.ts` (spike served its purpose)

Real e2e test with actual agent server:
1. Start agent server on random port with mock bot config
2. POST /tasks → verify pending
3. Wait for execution (mock forwardQueryToBot)
4. GET /tasks/:id → verify completed with result
5. Create another task, cancel it mid-execution
6. Verify task list filtering

Follow `packages/integration/__tests__/mesh-query.test.ts` pattern.

- [ ] **Step 1-4: TDD cycle**

- [ ] **Step 5: Remove spike test, commit**

```bash
git commit -m "test(integration): add task protocol e2e test, remove spike"
```

---

## Task 8: Documentation + Website + Final Verification

**Files:**
- Modify: `website/docs/reference/api/agent.md` — add /tasks routes
- Modify: `website/docs/reference/cli/orchestration.md` — add task commands
- Modify: `website/docs/features/multi-agent.md` — add task protocol section

- [ ] **Step 1: Add task route docs to agent.md**
- [ ] **Step 2: Add task commands to orchestration.md**
- [ ] **Step 3: Add task protocol overview to multi-agent.md**
- [ ] **Step 4: Verify website builds**

```bash
pnpm --filter @mecha/website build
```

- [ ] **Step 5: Full verification**

```bash
pnpm build && pnpm typecheck && pnpm lint && pnpm test && pnpm test:coverage
```

- [ ] **Step 6: Commit**

```bash
git commit -m "docs: add task protocol documentation"
```

---

## Summary

| Task | What | Packages | Key Risk |
|------|------|----------|----------|
| 1 | E2E spike | integration | Proves model before investing |
| 2 | Core types + storage | core | Foundation — all else depends |
| 3 | CLI commands | cli | CLI-first enforcement |
| 4 | Agent routes + executor | agent | The hard part — async exec + cancel |
| 5 | Service layer | service | Wires CLI to agent |
| 6 | MCP tools | runtime | Bots can create tasks |
| 7 | Integration test | integration | Real e2e proof |
| 8 | Docs + verification | website | Ship it |

**What's explicitly NOT in v1:**
- Cross-node tasks (remote target@node)
- Webhook push notifications
- JSON Schema validation on input/output
- Priority field
- Task artifacts (intermediate outputs)
- SSE streaming from agent server (progress comes from bot's /api/events)

These are queued for v2 after the foundation proves out.
