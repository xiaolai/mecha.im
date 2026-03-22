# Task Protocol Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an A2A-inspired task lifecycle to mecha so bots can delegate long-running work with streaming progress, structured schemas, and async push notifications.

**Architecture:** Tasks are JSON files stored at `~/.mecha/tasks/<id>.json`. The agent server gets new `/tasks` routes with SSE streaming. Bots create/monitor tasks via new MCP tools. CLI gets `mecha task` commands. The existing `mesh_query` remains unchanged for quick sync queries.

**Tech Stack:** TypeScript, Fastify (SSE via raw response), Zod (schema validation), vitest

**Spec:** `.claude/plans/inter-bot-communication-spec.md` — Subsystem 1: Task Protocol

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `packages/core/src/task-types.ts` | Task, TaskStatus, TaskArtifact types + Zod schemas |
| `packages/core/src/task-storage.ts` | Read/write/list/clean task JSON files from `~/.mecha/tasks/` |
| `packages/agent/src/task-routes.ts` | Fastify routes: POST/GET/DELETE /tasks, GET /tasks/:id/stream |
| `packages/agent/src/task-sse.ts` | SSE helper: write TaskStatusUpdate and TaskArtifact events |
| `packages/runtime/src/mcp/task-tools.ts` | MCP tools: task_create, task_status, task_cancel, task_list |
| `packages/service/src/task-ops.ts` | Service functions: createTask, getTask, cancelTask, listTasks |
| `packages/cli/src/commands/task-list.ts` | `mecha task list` command |
| `packages/cli/src/commands/task-show.ts` | `mecha task show <id>` command |
| `packages/cli/src/commands/task-cancel.ts` | `mecha task cancel <id>` command |

### Modified Files

| File | Change |
|------|--------|
| `packages/core/src/index.ts` | Re-export task types and storage |
| `packages/agent/src/index.ts` | Re-export task routes |
| `packages/agent/src/server.ts` | Register task routes |
| `packages/runtime/src/mcp/server.ts` | Register task MCP tools |
| `packages/cli/src/commands/task.ts` | Register task subcommands (new parent) |
| `packages/cli/src/program.ts` | Register `mecha task` command group |

### Test Files

| File | What it tests |
|------|--------------|
| `packages/core/__tests__/task-types.test.ts` | Zod schema validation |
| `packages/core/__tests__/task-storage.test.ts` | CRUD operations on task files |
| `packages/agent/__tests__/task-routes.test.ts` | HTTP routes with real Fastify injection |
| `packages/agent/__tests__/task-sse.test.ts` | SSE event formatting |
| `packages/service/__tests__/task-ops.test.ts` | Service layer task operations |
| `packages/cli/__tests__/commands/task.test.ts` | CLI task commands |

---

## Task 1: Core Types + Zod Schemas

**Files:**
- Create: `packages/core/src/task-types.ts`
- Create: `packages/core/__tests__/task-types.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write failing test for TaskStatus schema**

```typescript
// packages/core/__tests__/task-types.test.ts
import { describe, it, expect } from "vitest";
import { TaskStatusSchema, TaskSchema, TaskCreateInputSchema } from "../src/task-types.js";

describe("TaskStatusSchema", () => {
  it("accepts valid statuses", () => {
    for (const s of ["pending", "working", "completed", "failed", "cancelled", "rejected"]) {
      expect(TaskStatusSchema.parse(s)).toBe(s);
    }
  });

  it("rejects invalid status", () => {
    expect(() => TaskStatusSchema.parse("running")).toThrow();
  });
});

describe("TaskSchema", () => {
  it("validates a complete task", () => {
    const task = {
      id: "task-abc",
      source: "coder@alice",
      target: "analyst",
      status: "pending",
      message: "Review this code",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      artifacts: [],
    };
    expect(TaskSchema.parse(task)).toMatchObject({ id: "task-abc", status: "pending" });
  });

  it("accepts optional fields", () => {
    const task = {
      id: "task-abc",
      source: "coder@alice",
      target: "analyst",
      status: "completed",
      message: "Review this code",
      result: { approved: true },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      artifacts: [{ type: "text", data: "looks good", createdAt: new Date().toISOString() }],
    };
    expect(TaskSchema.parse(task).result).toEqual({ approved: true });
  });

  it("rejects task without required fields", () => {
    expect(() => TaskSchema.parse({ id: "x" })).toThrow();
  });
});

describe("TaskCreateInputSchema", () => {
  it("validates create input", () => {
    const input = { bot: "analyst", message: "Review code" };
    expect(TaskCreateInputSchema.parse(input)).toMatchObject({ bot: "analyst" });
  });

  it("accepts priority and schemas", () => {
    const input = {
      bot: "analyst",
      message: "Review code",
      priority: "high",
      outputSchema: { type: "object", properties: { approved: { type: "boolean" } } },
    };
    expect(TaskCreateInputSchema.parse(input).priority).toBe("high");
  });

  it("rejects empty message", () => {
    expect(() => TaskCreateInputSchema.parse({ bot: "analyst", message: "" })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/core/__tests__/task-types.test.ts`
Expected: FAIL — cannot import `task-types.js`

- [ ] **Step 3: Implement task types**

```typescript
// packages/core/src/task-types.ts
import { z } from "zod";

export const TaskStatusSchema = z.enum([
  "pending", "working", "completed", "failed", "cancelled", "rejected",
]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TaskArtifactSchema = z.object({
  type: z.string(),
  data: z.unknown(),
  createdAt: z.string(),
});
export type TaskArtifact = z.infer<typeof TaskArtifactSchema>;

export const PrioritySchema = z.enum(["high", "normal", "low"]).default("normal");
export type Priority = z.infer<typeof PrioritySchema>;

export const TaskSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  status: TaskStatusSchema,
  message: z.string().min(1),
  priority: PrioritySchema.optional(),
  inputSchema: z.record(z.unknown()).optional(),
  outputSchema: z.record(z.unknown()).optional(),
  result: z.unknown().optional(),
  error: z.string().optional(),
  webhookUrl: z.string().url().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  artifacts: z.array(TaskArtifactSchema),
});
export type Task = z.infer<typeof TaskSchema>;

export const TaskCreateInputSchema = z.object({
  bot: z.string().min(1),
  message: z.string().min(1),
  priority: PrioritySchema.optional(),
  inputSchema: z.record(z.unknown()).optional(),
  outputSchema: z.record(z.unknown()).optional(),
  webhookUrl: z.string().url().optional(),
});
export type TaskCreateInput = z.infer<typeof TaskCreateInputSchema>;

export const TaskStatusUpdateSchema = z.object({
  taskId: z.string().min(1),
  status: TaskStatusSchema,
  message: z.string().optional(),
  timestamp: z.string(),
});
export type TaskStatusUpdate = z.infer<typeof TaskStatusUpdateSchema>;

export const TERMINAL_STATUSES: TaskStatus[] = ["completed", "failed", "cancelled", "rejected"];
```

- [ ] **Step 4: Add re-exports to core barrel**

Add to `packages/core/src/index.ts`:
```typescript
export {
  TaskStatusSchema, TaskSchema, TaskCreateInputSchema, TaskArtifactSchema,
  TaskStatusUpdateSchema, PrioritySchema, TERMINAL_STATUSES,
} from "./task-types.js";
export type {
  Task, TaskStatus, TaskArtifact, TaskCreateInput, TaskStatusUpdate, Priority,
} from "./task-types.js";
```

- [ ] **Step 5: Run tests and verify they pass**

Run: `pnpm vitest run packages/core/__tests__/task-types.test.ts`
Expected: PASS (all 7 assertions)

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/task-types.ts packages/core/__tests__/task-types.test.ts packages/core/src/index.ts
git commit -m "feat(core): add Task types and Zod schemas for task protocol"
```

---

## Task 2: Task Storage

**Files:**
- Create: `packages/core/src/task-storage.ts`
- Create: `packages/core/__tests__/task-storage.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write failing tests for task storage**

```typescript
// packages/core/__tests__/task-storage.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  writeTask, readTask, listTasks, deleteTask, cleanExpiredTasks,
} from "../src/task-storage.js";
import type { Task } from "../src/task-types.js";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-001",
    source: "coder@alice",
    target: "analyst",
    status: "pending",
    message: "Review this",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    artifacts: [],
    ...overrides,
  };
}

describe("task-storage", () => {
  let tasksDir: string;

  beforeEach(() => {
    tasksDir = mkdtempSync(join(tmpdir(), "tasks-"));
  });
  afterEach(() => {
    rmSync(tasksDir, { recursive: true, force: true });
  });

  it("writes and reads a task", () => {
    const task = makeTask();
    writeTask(tasksDir, task);
    const loaded = readTask(tasksDir, task.id);
    expect(loaded).toMatchObject({ id: "task-001", status: "pending" });
  });

  it("returns undefined for non-existent task", () => {
    expect(readTask(tasksDir, "nope")).toBeUndefined();
  });

  it("lists tasks with optional status filter", () => {
    writeTask(tasksDir, makeTask({ id: "t1", status: "pending" }));
    writeTask(tasksDir, makeTask({ id: "t2", status: "working" }));
    writeTask(tasksDir, makeTask({ id: "t3", status: "completed" }));

    expect(listTasks(tasksDir)).toHaveLength(3);
    expect(listTasks(tasksDir, { status: "pending" })).toHaveLength(1);
    expect(listTasks(tasksDir, { bot: "analyst" })).toHaveLength(3);
  });

  it("deletes a task", () => {
    writeTask(tasksDir, makeTask());
    expect(deleteTask(tasksDir, "task-001")).toBe(true);
    expect(readTask(tasksDir, "task-001")).toBeUndefined();
    expect(deleteTask(tasksDir, "task-001")).toBe(false);
  });

  it("cleans tasks older than retention days", () => {
    const old = new Date(Date.now() - 8 * 86400000).toISOString();
    writeTask(tasksDir, makeTask({ id: "old", status: "completed", createdAt: old, updatedAt: old }));
    writeTask(tasksDir, makeTask({ id: "new", status: "completed" }));

    const cleaned = cleanExpiredTasks(tasksDir, 7);
    expect(cleaned).toBe(1);
    expect(readTask(tasksDir, "old")).toBeUndefined();
    expect(readTask(tasksDir, "new")).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/core/__tests__/task-storage.test.ts`
Expected: FAIL — cannot import `task-storage.js`

- [ ] **Step 3: Implement task storage**

```typescript
// packages/core/src/task-storage.ts
import { readFileSync, writeFileSync, readdirSync, unlinkSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { TaskSchema, TERMINAL_STATUSES } from "./task-types.js";
import type { Task, TaskStatus } from "./task-types.js";

function taskPath(tasksDir: string, id: string): string {
  return join(tasksDir, `${id}.json`);
}

export function writeTask(tasksDir: string, task: Task): void {
  mkdirSync(tasksDir, { recursive: true });
  writeFileSync(taskPath(tasksDir, task.id), JSON.stringify(task, null, 2) + "\n", { mode: 0o600 });
}

export function readTask(tasksDir: string, id: string): Task | undefined {
  const p = taskPath(tasksDir, id);
  if (!existsSync(p)) return undefined;
  try {
    return TaskSchema.parse(JSON.parse(readFileSync(p, "utf-8")));
  } catch {
    return undefined;
  }
}

export function listTasks(
  tasksDir: string,
  filter?: { status?: TaskStatus; bot?: string },
): Task[] {
  if (!existsSync(tasksDir)) return [];
  const files = readdirSync(tasksDir).filter((f) => f.endsWith(".json"));
  const tasks: Task[] = [];
  for (const file of files) {
    const task = readTask(tasksDir, file.replace(".json", ""));
    if (!task) continue;
    if (filter?.status && task.status !== filter.status) continue;
    if (filter?.bot && task.target !== filter.bot) continue;
    tasks.push(task);
  }
  return tasks.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function deleteTask(tasksDir: string, id: string): boolean {
  const p = taskPath(tasksDir, id);
  if (!existsSync(p)) return false;
  unlinkSync(p);
  return true;
}

export function cleanExpiredTasks(tasksDir: string, retentionDays: number): number {
  const cutoff = Date.now() - retentionDays * 86400000;
  const tasks = listTasks(tasksDir);
  let cleaned = 0;
  for (const task of tasks) {
    if (TERMINAL_STATUSES.includes(task.status) && new Date(task.updatedAt).getTime() < cutoff) {
      deleteTask(tasksDir, task.id);
      cleaned++;
    }
  }
  return cleaned;
}

export function tasksDir(mechaDir: string): string {
  return join(mechaDir, "tasks");
}
```

- [ ] **Step 4: Add re-exports to core barrel**

Add to `packages/core/src/index.ts`:
```typescript
export { writeTask, readTask, listTasks, deleteTask, cleanExpiredTasks, tasksDir } from "./task-storage.js";
```

- [ ] **Step 5: Run tests and verify they pass**

Run: `pnpm vitest run packages/core/__tests__/task-storage.test.ts`
Expected: PASS (all 5 tests)

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/task-storage.ts packages/core/__tests__/task-storage.test.ts packages/core/src/index.ts
git commit -m "feat(core): add task storage — read/write/list/clean task JSON files"
```

---

## Task 3: SSE Helper

**Files:**
- Create: `packages/agent/src/task-sse.ts`
- Create: `packages/agent/__tests__/task-sse.test.ts`

- [ ] **Step 1: Write failing test for SSE formatting**

```typescript
// packages/agent/__tests__/task-sse.test.ts
import { describe, it, expect } from "vitest";
import { formatSSE, formatTaskStatusEvent, formatTaskArtifactEvent } from "../src/task-sse.js";

describe("formatSSE", () => {
  it("formats a named event", () => {
    const result = formatSSE("status", { taskId: "t1", status: "working" });
    expect(result).toBe('event: status\ndata: {"taskId":"t1","status":"working"}\n\n');
  });
});

describe("formatTaskStatusEvent", () => {
  it("formats a status update event", () => {
    const result = formatTaskStatusEvent("t1", "working", "Analyzing...");
    expect(result).toContain("event: status");
    expect(result).toContain('"status":"working"');
    expect(result).toContain('"message":"Analyzing..."');
  });
});

describe("formatTaskArtifactEvent", () => {
  it("formats an artifact event", () => {
    const result = formatTaskArtifactEvent("t1", "text", "partial result");
    expect(result).toContain("event: artifact");
    expect(result).toContain('"type":"text"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/agent/__tests__/task-sse.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement SSE helper**

```typescript
// packages/agent/src/task-sse.ts
import type { TaskStatus } from "@mecha/core";

export function formatSSE(event: string, data: Record<string, unknown>): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function formatTaskStatusEvent(
  taskId: string, status: TaskStatus, message?: string,
): string {
  return formatSSE("status", {
    taskId,
    status,
    ...(message ? { message } : {}),
    timestamp: new Date().toISOString(),
  });
}

export function formatTaskArtifactEvent(
  taskId: string, type: string, data: unknown,
): string {
  return formatSSE("artifact", {
    taskId,
    type,
    data,
    createdAt: new Date().toISOString(),
  });
}
```

- [ ] **Step 4: Run tests and verify they pass**

Run: `pnpm vitest run packages/agent/__tests__/task-sse.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/task-sse.ts packages/agent/__tests__/task-sse.test.ts
git commit -m "feat(agent): add SSE helper for task status and artifact events"
```

---

## Task 4: Agent Server Task Routes

**Files:**
- Create: `packages/agent/src/task-routes.ts`
- Create: `packages/agent/__tests__/task-routes.test.ts`
- Modify: `packages/agent/src/server.ts` — register routes
- Modify: `packages/agent/src/index.ts` — re-export

This is the largest task. The routes are:
- `POST /tasks` — create a task
- `GET /tasks/:id` — get task state
- `GET /tasks/:id/stream` — SSE stream
- `POST /tasks/:id/cancel` — cancel
- `GET /tasks` — list tasks

- [ ] **Step 1: Write failing tests for task routes**

Test creates a real Fastify server via `createAgentServer`, sends HTTP requests, asserts responses. Follow the pattern in `packages/agent/__tests__/server.test.ts`.

Test cases:
- POST /tasks with valid input → 201 with task id
- POST /tasks with invalid bot → 400
- GET /tasks/:id → 200 with task object
- GET /tasks/:id with bad id → 404
- POST /tasks/:id/cancel → 200
- GET /tasks → 200 with array
- GET /tasks/:id/stream → SSE content-type, receives events

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement task-routes.ts**

The route handler for `POST /tasks`:
1. Validate input with `TaskCreateInputSchema`
2. Check bot exists via `readBotConfig(join(mechaDir, input.bot))`
3. ACL check: `acl.check(source, input.bot, "query")`
4. Generate task ID: `task-${randomUUID().slice(0, 8)}`
5. Write task to storage with status `pending`
6. Forward the task message to the bot via `forwardQueryToBot` (async — don't await)
7. Return 201 with `{ taskId, status: "pending" }`

The forwarding happens in a fire-and-forget async block that:
1. Updates task status to `working`
2. Calls `forwardQueryToBot`
3. On success: updates status to `completed`, stores result
4. On failure: updates status to `failed`, stores error

The SSE route (`GET /tasks/:id/stream`):
1. Set headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`
2. Poll task file every 500ms, emit status/artifact events on changes
3. Close stream when task reaches terminal state

- [ ] **Step 4: Register routes in server.ts**

Add to `createAgentServer`:
```typescript
import { registerTaskRoutes } from "./task-routes.js";
registerTaskRoutes(app, { mechaDir, acl, authCtx });
```

- [ ] **Step 5: Run tests and verify they pass**

Run: `pnpm vitest run packages/agent/__tests__/task-routes.test.ts`
Expected: PASS

- [ ] **Step 6: Run full agent test suite**

Run: `pnpm vitest run --project agent`
Expected: All tests pass (no regressions)

- [ ] **Step 7: Commit**

```bash
git add packages/agent/src/task-routes.ts packages/agent/__tests__/task-routes.test.ts packages/agent/src/server.ts packages/agent/src/index.ts
git commit -m "feat(agent): add /tasks routes with SSE streaming"
```

---

## Task 5: Service Layer

**Files:**
- Create: `packages/service/src/task-ops.ts`
- Create: `packages/service/__tests__/task-ops.test.ts`
- Modify: `packages/service/src/index.ts`

Service functions that the CLI and runtime use to interact with tasks via HTTP (for remote) or filesystem (for local).

Functions:
- `createTask(pm, mechaDir, target, input)` — POST to agent server
- `getTask(pm, mechaDir, taskId)` — GET from agent server
- `cancelTask(pm, mechaDir, taskId)` — POST cancel
- `listTasks(pm, mechaDir, opts?)` — GET list

- [ ] **Step 1-5: TDD cycle** (same pattern as above)

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(service): add task operation service functions"
```

---

## Task 6: MCP Tools

**Files:**
- Create: `packages/runtime/src/mcp/task-tools.ts`
- Create: `packages/runtime/__tests__/mcp/task-tools.test.ts`
- Modify: `packages/runtime/src/mcp/server.ts` — register tools

MCP tools:
- `task_create` — creates a task on a target bot
- `task_status` — checks task state
- `task_cancel` — cancels a running task
- `task_list` — lists tasks with filters

Follow the pattern in `packages/runtime/src/mcp/bus-tools.ts`.

- [ ] **Step 1-5: TDD cycle**

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(runtime): add task MCP tools (create, status, cancel, list)"
```

---

## Task 7: CLI Commands

**Files:**
- Create: `packages/cli/src/commands/task.ts` — parent command
- Create: `packages/cli/src/commands/task-list.ts`
- Create: `packages/cli/src/commands/task-show.ts`
- Create: `packages/cli/src/commands/task-cancel.ts`
- Create: `packages/cli/__tests__/commands/task.test.ts`
- Modify: `packages/cli/src/program.ts` — register `mecha task`

Follow existing CLI patterns:
- `mecha task list [--bot <name>] [--status <status>]`
- `mecha task show <id>`
- `mecha task cancel <id>`

- [ ] **Step 1-5: TDD cycle**

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(cli): add mecha task list/show/cancel commands"
```

---

## Task 8: Integration Test

**Files:**
- Create: `packages/integration/__tests__/task-protocol.test.ts`

End-to-end test:
1. Start agent server on random port
2. Create a task via HTTP
3. Verify task transitions: pending → working → completed
4. Verify SSE stream delivers status events
5. Verify task result is stored

Follow the pattern in `packages/integration/__tests__/mesh-query.test.ts`.

- [ ] **Step 1-5: TDD cycle**

- [ ] **Step 6: Commit**

```bash
git commit -m "test(integration): add task protocol e2e test"
```

---

## Task 9: Documentation

**Files:**
- Modify: `website/docs/features/multi-agent.md` — add task protocol section
- Create: `website/docs/reference/cli/orchestration.md` — add task commands (append)
- Modify: `website/docs/reference/api/agent.md` — add /tasks routes
- Modify: `website/docs/reference/api/index.md` — mention task protocol

- [ ] **Step 1: Add task protocol documentation**
- [ ] **Step 2: Verify website builds**: `pnpm --filter @mecha/website build`
- [ ] **Step 3: Commit**

```bash
git commit -m "docs: add task protocol documentation"
```

---

## Task 10: Final Verification

- [ ] **Step 1: Run full build**

```bash
pnpm build
```
Expected: All packages build

- [ ] **Step 2: Run typecheck**

```bash
pnpm typecheck
```
Expected: No errors

- [ ] **Step 3: Run lint**

```bash
pnpm lint
```
Expected: Clean

- [ ] **Step 4: Run full test suite**

```bash
pnpm test
```
Expected: All tests pass

- [ ] **Step 5: Run coverage**

```bash
pnpm test:coverage
```
Expected: Coverage meets thresholds

- [ ] **Step 6: Final commit (if any fixups needed)**

```bash
git commit -m "chore: task protocol final fixups"
```
