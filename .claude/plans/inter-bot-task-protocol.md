# Task Protocol Implementation Plan (v3 — Runtime-Side Execution)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an A2A-inspired task lifecycle to mecha so bots can delegate long-running work with real cancellation, progress streaming, and result collection.

**Architecture:** Task state is JSON files on the agent server (`~/.mecha/tasks/`). Task *execution* happens in the bot's runtime process via a new `POST /api/tasks` route that calls `sdkChat` directly — giving real `AbortController` cancellation and `ActivityEmitter` progress. The agent server proxies task operations to the runtime. Progress is streamed via the existing `/api/events` SSE with a `taskId` correlation field. CLI-first.

**Tech Stack:** TypeScript, Fastify, Zod, vitest

**Key design decisions:**
- **v1 is local-only** — no cross-node, no webhooks
- **Execution in runtime** — `sdkChat` with `AbortController`, not `forwardQueryToBot`
- **Progress via existing SSE** — add `taskId` to activity events for correlation
- **Cancellation is real** — `AbortController.abort()` kills the SDK query
- **Results are text** — schema validation deferred to v2
- **Task ownership: agent-local** — JSON files on the agent server
- **ACL capability: `query`** — reuses existing capability (tasks are queries)
- **Source for CLI: `admin`** — CLI-originated tasks use `admin` as source
- **Artifacts: removed from v1** — `artifacts` field removed from schema
- **No timeout on task execution** — tasks run until done (no 60s limit)
- **Startup reconciliation** — on agent start, mark stale `working` tasks as `failed`
- **Cleanup: opportunistic** — `cleanExpiredTasks` runs on `task list` calls

---

## Contracts

```typescript
// Canonical types — all layers use these exactly
type TaskStatus = "pending" | "working" | "completed" | "failed" | "cancelled";
const TERMINAL_STATUSES = ["completed", "failed", "cancelled"];

interface Task {
  id: string;           // "task-<8-hex>"
  source: string;       // "admin" (CLI) or "bot@node" (MCP)
  target: string;       // bot name
  status: TaskStatus;
  message: string;
  result?: string;      // text response (when completed)
  error?: string;       // error message (when failed)
  sessionId?: string;   // SDK session for continuations
  durationMs?: number;  // execution time
  costUsd?: number;     // API cost
  createdAt: string;    // ISO 8601
  updatedAt: string;    // ISO 8601
}

interface TaskCreateInput {
  target: string;       // bot name
  message: string;      // task instruction
}
```

**Agent server routes:**
- `POST /tasks` → create + start execution → `201 { id, status }`
- `GET /tasks` → list (query: `?target=X&status=Y`) → `200 Task[]`
- `GET /tasks/:id` → get → `200 Task` or `404`
- `POST /tasks/:id/cancel` → cancel → `200` or `404` or `409`

**Runtime routes (new, on bot process):**
- `POST /api/tasks` → accept + execute with sdkChat → `202 { accepted: true }`
- `POST /api/tasks/:id/cancel` → abort the running query → `200` or `404`
- `GET /api/tasks/:id/status` → return current status → `200`

**Auth:** Same as existing routes — session cookie or Bearer token. CLI uses TOTP session.

---

## State Transitions

```
POST /tasks             →  pending
Agent proxies to runtime →  working (runtime accepted)
sdkChat completes        →  completed (with result)
sdkChat throws           →  failed (with error)
POST /tasks/:id/cancel   →  cancelled (AbortController.abort)
Agent restart            →  working → failed ("agent restarted")
Bot stopped              →  pending → failed ("bot not running")
```

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `packages/core/src/task-types.ts` | Task, TaskStatus types + Zod schemas |
| `packages/core/src/task-storage.ts` | Read/write/list/clean task JSON files |
| `packages/runtime/src/routes/tasks.ts` | Runtime `POST /api/tasks`, `POST /api/tasks/:id/cancel` |
| `packages/runtime/src/task-runner.ts` | sdkChat wrapper with AbortController registry |
| `packages/agent/src/task-routes.ts` | Agent server /tasks routes (proxy to runtime) |
| `packages/service/src/task-ops.ts` | HTTP helpers for agent server task API |
| `packages/cli/src/commands/task.ts` | Parent command |
| `packages/cli/src/commands/task-create.ts` | `mecha task create <target> <message>` |
| `packages/cli/src/commands/task-list.ts` | `mecha task list` |
| `packages/cli/src/commands/task-show.ts` | `mecha task show <id>` |
| `packages/cli/src/commands/task-cancel.ts` | `mecha task cancel <id>` |
| `packages/runtime/src/mcp/task-tools.ts` | MCP tools for bots |

### Modified Files

| File | Change |
|------|--------|
| `packages/core/src/index.ts` | Re-export task types + storage |
| `packages/runtime/src/server.ts` | Register `/api/tasks` routes |
| `packages/runtime/src/sdk-chat-activity.ts` | Add optional `taskId` to activity events |
| `packages/agent/src/server.ts` | Register agent `/tasks` routes |
| `packages/service/src/index.ts` | Re-export task-ops |
| `packages/cli/src/program.ts` | Register `mecha task` group |

---

## Task 1: Runtime Task Execution Spike

**Goal:** Prove that a task can be created in the runtime, executed via `sdkChat`, cancelled via `AbortController`, and have its progress correlated via `taskId` in activity events — all through real code paths, not mocks.

**Files:**
- Create: `packages/runtime/__tests__/task-runner-spike.test.ts`

- [ ] **Step 1: Write spike test**

The spike mocks `sdkChat` at the module level (not inline) to avoid spawning real Claude processes, but tests the real `AbortController` flow, the real task-runner registry, and the real state machine.

Tests:
1. `executeTask` → calls sdkChat, returns result, task transitions pending→working→completed
2. `cancelTask` → aborts the AbortController, sdkChat rejects, task transitions to cancelled
3. Two concurrent tasks on same bot → both tracked independently by taskId

- [ ] **Step 2: Run spike — verify it passes**
- [ ] **Step 3: Commit**

```bash
git commit -m "spike: prove runtime task execution model (sdkChat + AbortController)"
```

---

## Task 2: Core Types + Storage

**Files:**
- Create: `packages/core/src/task-types.ts`
- Create: `packages/core/src/task-storage.ts`
- Create: `packages/core/__tests__/task-types.test.ts`
- Create: `packages/core/__tests__/task-storage.test.ts`
- Modify: `packages/core/src/index.ts`

Types from the Contracts section above. Storage: `writeTask`, `readTask`, `listTasks`, `deleteTask`, `cleanExpiredTasks`, `tasksDir`, `reconcileStaleTasks`.

`reconcileStaleTasks(tasksDir)`: on startup, find all tasks with `status: "working"`, set them to `failed` with `error: "agent restarted"`.

- [ ] **Step 1: Write failing tests for types** (7 test cases)
- [ ] **Step 2: Implement task-types.ts**
- [ ] **Step 3: Write failing tests for storage** (6 test cases including reconcile)
- [ ] **Step 4: Implement task-storage.ts**
- [ ] **Step 5: Add re-exports, run tests, commit**

```bash
git commit -m "feat(core): add task types and storage with startup reconciliation"
```

---

## Task 3: Runtime Task Runner + Routes

**Files:**
- Create: `packages/runtime/src/task-runner.ts`
- Create: `packages/runtime/src/routes/tasks.ts`
- Create: `packages/runtime/__tests__/task-runner.test.ts`
- Create: `packages/runtime/__tests__/routes/tasks.test.ts`
- Modify: `packages/runtime/src/server.ts`
- Modify: `packages/runtime/src/sdk-chat-activity.ts` (add taskId)

**task-runner.ts:**
```typescript
// Registry: Map<taskId, AbortController>
// startTask(taskId, sdkChatOpts, message, callback): void
//   - Creates AbortController, registers in map
//   - Calls sdkChat(opts, message, undefined, ac.signal)
//   - On success: callback({ status: "completed", result, sessionId, durationMs, costUsd })
//   - On error: callback({ status: ac.signal.aborted ? "cancelled" : "failed", error })
//   - Finally: removes from registry
// cancelTask(taskId): boolean — calls ac.abort(), returns true if found
// isRunning(taskId): boolean
```

**routes/tasks.ts:**
```
POST /api/tasks — { taskId, message } → start execution, return 202
POST /api/tasks/:id/cancel → abort, return 200/404
GET /api/tasks/:id/status → return { status, result?, error? }
```

The route handler calls `taskRunner.startTask()` with a callback that writes the result back to the agent (or stores locally for now).

**sdk-chat-activity.ts change:** Add optional `taskId` field to emitted activity events so consumers can filter by task.

- [ ] **Step 1: Write failing tests for task-runner** (mock sdkChat)
- [ ] **Step 2: Implement task-runner.ts**
- [ ] **Step 3: Write failing tests for routes** (Fastify inject)
- [ ] **Step 4: Implement routes/tasks.ts**
- [ ] **Step 5: Add taskId to activity events**
- [ ] **Step 6: Register routes, run tests, commit**

```bash
git commit -m "feat(runtime): add task runner with sdkChat execution and /api/tasks routes"
```

---

## Task 4: Service Layer (agent HTTP helpers)

**Files:**
- Create: `packages/service/src/task-ops.ts`
- Create: `packages/service/__tests__/task-ops.test.ts`
- Modify: `packages/service/src/index.ts`

HTTP helpers that talk to the agent server. Used by both CLI and MCP.

```typescript
// taskCreate(agentUrl: string, auth: string, input: TaskCreateInput): Promise<{ id: string }>
// taskGet(agentUrl: string, auth: string, id: string): Promise<Task>
// taskCancel(agentUrl: string, auth: string, id: string): Promise<void>
// taskList(agentUrl: string, auth: string, opts?: { target?: string; status?: string }): Promise<Task[]>
```

Auth parameter is the session cookie or Bearer token string. Agent URL comes from `detectAgent(mechaDir)`.

- [ ] **Step 1: Write failing tests** (mock fetch)
- [ ] **Step 2: Implement task-ops.ts**
- [ ] **Step 3: Add re-exports, run tests, commit**

```bash
git commit -m "feat(service): add task HTTP helpers for agent server API"
```

---

## Task 5: CLI Commands (CLI-first)

**Files:**
- Create: `packages/cli/src/commands/task.ts`
- Create: `packages/cli/src/commands/task-create.ts`
- Create: `packages/cli/src/commands/task-list.ts`
- Create: `packages/cli/src/commands/task-show.ts`
- Create: `packages/cli/src/commands/task-cancel.ts`
- Create: `packages/cli/__tests__/commands/task.test.ts`
- Modify: `packages/cli/src/program.ts`

CLI uses `detectAgent` + service task-ops. Auth from TOTP session.

```
mecha task create <target> <message>     → POST /tasks → "Task task-abc123 created"
mecha task list [--target X] [--status Y] → GET /tasks → table
mecha task show <id>                      → GET /tasks/:id → detail view
mecha task cancel <id>                    → POST /tasks/:id/cancel → "Cancelled"
```

- [ ] **Step 1: Write failing tests** (mock service layer)
- [ ] **Step 2: Implement CLI commands**
- [ ] **Step 3: Register in program.ts, run tests, commit**

```bash
git commit -m "feat(cli): add mecha task create/list/show/cancel commands"
```

---

## Task 6: Agent Server Task Routes (proxy)

**Files:**
- Create: `packages/agent/src/task-routes.ts`
- Create: `packages/agent/__tests__/task-routes.test.ts`
- Modify: `packages/agent/src/server.ts`

The agent server's `/tasks` routes:
1. **POST /tasks** — validate input, ACL check (`query` capability), write task as `pending`, proxy `POST /api/tasks` to bot runtime (via `forwardQueryToBot`-style fetch but to `/api/tasks` with no timeout), write `working` on 202, return task ID
2. **GET /tasks** — read from task storage, filter by query params
3. **GET /tasks/:id** — read single task
4. **POST /tasks/:id/cancel** — proxy cancel to runtime, update task status

The proxy to runtime uses bot's port/token from `readBotConfig`. No 60s timeout — uses a long timeout (10 min) or no timeout for task execution.

- [ ] **Step 1: Write failing tests** (mock forwardQueryToBot or use real Fastify)
- [ ] **Step 2: Implement task-routes.ts**
- [ ] **Step 3: Add startup reconciliation** — call `reconcileStaleTasks` in `createAgentServer`
- [ ] **Step 4: Register routes, run tests, commit**

```bash
git commit -m "feat(agent): add /tasks proxy routes with startup reconciliation"
```

---

## Task 7: MCP Tools

**Files:**
- Create: `packages/runtime/src/mcp/task-tools.ts`
- Create: `packages/runtime/__tests__/mcp/task-tools.test.ts`
- Modify: `packages/runtime/src/mcp/server.ts`

MCP tools for bot-to-bot task delegation:
- `task_create(target, message)` — POST to agent server /tasks
- `task_status(taskId)` — GET from agent server
- `task_cancel(taskId)` — POST cancel to agent server
- `task_list(target?, status?)` — GET list from agent server

The MCP tool handler needs the agent server URL. It can read `agent.json` from `mechaDir` (same as CLI).

- [ ] **Step 1: Write failing tests**
- [ ] **Step 2: Implement task-tools.ts**
- [ ] **Step 3: Register in MCP server, run tests, commit**

```bash
git commit -m "feat(runtime): add task MCP tools (create, status, cancel, list)"
```

---

## Task 8: Integration Test

**Files:**
- Create: `packages/integration/__tests__/task-protocol.test.ts`
- Delete: `packages/runtime/__tests__/task-runner-spike.test.ts`

Real e2e with agent server + bot runtime:
1. Start agent server on random port with bot config pointing to a mock runtime
2. Start a minimal runtime server with `/api/tasks` route (mock sdkChat)
3. POST /tasks → verify pending → working → completed
4. Verify task result and metadata (durationMs, sessionId)
5. Create task, cancel mid-execution → verify cancelled
6. List tasks with filters → verify filtering
7. Restart agent → verify stale working tasks marked failed

- [ ] **Step 1-4: Write and run integration tests**
- [ ] **Step 5: Remove spike, commit**

```bash
git commit -m "test(integration): add task protocol e2e test"
```

---

## Task 9: Documentation + Final Verification

**Files:**
- Modify: `website/docs/reference/api/agent.md` — add /tasks routes
- Modify: `website/docs/reference/cli/orchestration.md` — add task commands
- Modify: `website/docs/features/multi-agent.md` — add task protocol section

- [ ] **Step 1: Update docs**
- [ ] **Step 2: Verify website builds**
- [ ] **Step 3: Full gate verification**

```bash
pnpm build && pnpm typecheck && pnpm lint && pnpm test && pnpm test:coverage
```

- [ ] **Step 4: Commit**

```bash
git commit -m "docs: add task protocol documentation"
```

---

## Summary

| Task | What | Packages | Risk Level |
|------|------|----------|------------|
| 1 | Spike: prove runtime execution model | runtime | De-risks everything |
| 2 | Core types + storage + reconciliation | core | Foundation |
| 3 | Runtime task runner + /api/tasks routes | runtime | **The hard part** |
| 4 | Service HTTP helpers | service | Glue layer |
| 5 | CLI commands | cli | CLI-first |
| 6 | Agent /tasks proxy routes | agent | Wiring |
| 7 | MCP tools | runtime | Bot-facing API |
| 8 | Integration test | integration | Real e2e proof |
| 9 | Docs + verification | website | Ship it |

**What's NOT in v1:** cross-node tasks, webhooks, JSON Schema validation, priority, artifacts, task-specific SSE endpoint.
