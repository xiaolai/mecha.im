---
plugin: grill
version: 1.2.0
date: 2026-03-22
target: feature/inter-bot-communication branch (task protocol)
style: Select All (styles 1-5)
addons: all
agents: [recon, architecture, error-handling, security, testing, edge-cases]
---

# Grill Report: Task Protocol (`feature/inter-bot-communication`)

**Scope:** 14 new source files (~1,004 LOC), 8 test files (~1,063 LOC), across 6 packages.

---

## Executive Summary

The task protocol implementation has a **sound architecture** (layered packages, real AbortController cancellation, proper auth/ACL) but a **fatal data flow gap**: task results never flow back from runtime to agent storage. Every completed task permanently shows "working." Additionally, the MCP tools are implemented but never wired into the MCP server, making bot-to-bot delegation dead code.

**Overall health:** The foundation is solid — types, storage, cancellation, and CLI are well-built. But the feature doesn't work end-to-end until 2 critical issues are fixed.

---

## Deduplicated Findings

### CRITICAL

| # | Finding | Source | File:Line | Effort |
|---|---------|--------|-----------|--------|
| C1 | **Task results never flow back from runtime to agent** — completed tasks permanently show "working" on disk. The runtime stores results in an ephemeral in-memory Map (100 entries, no TTL). No callback, polling, or push mechanism exists. | arch, error, edge | `agent/task-routes.ts:86-116`, `runtime/routes/tasks.ts:46-48` | 1-2 days |

### HIGH

| # | Finding | Source | File:Line | Effort |
|---|---------|--------|-----------|--------|
| H1 | **MCP task tools not wired into MCP server** — `TASK_TOOLS` defined and tested but never registered in `server.ts`. Bots can't use `task_create/status/cancel/list`. | arch, error | `runtime/mcp/task-tools.ts`, `runtime/mcp/server.ts` | 1 hour |
| H2 | **Path traversal via unsanitized task ID** — `readTask(dir, req.params.id)` passes URL params directly to `join(dir, id + ".json")`. Traversal like `../../bots/alice/config` leaks `.json` files. | security, edge | `core/task-storage.ts:10-12`, `agent/task-routes.ts:136` | 30 min |
| H3 | **TOCTOU race: cancel overwritten by fire-and-forget** — task object mutated by async proxy after HTTP response returned. Concurrent cancel can be silently overwritten with "working". | edge | `agent/task-routes.ts:75-118` | 2 hours |
| H4 | **x-mecha-source header spoofable** — any authenticated client can set `x-mecha-source: admin` to bypass ACL. Header is trusted without verification on local requests. | security, edge | `agent/task-routes.ts:59` | 2 hours |
| H5 | **handleTaskTool has no top-level try/catch** — network errors from `fetch()` throw unhandled exceptions instead of returning `{ isError: true }`. | error | `runtime/mcp/task-tools.ts:100-197` | 30 min |
| H6 | **CLI error handler only catches MechaError** — task-ops throws plain `Error`, users see raw stack traces when agent is down. | error | `cli/error-handler.ts:9-18` | 30 min |
| H7 | **Agent proxy logic has zero test coverage** — 29 lines of business-critical state transitions (pending→working/failed) wrapped in `v8 ignore`. | testing | `agent/task-routes.ts:86-116` | 2 hours |
| H8 | **No ACL on task read/cancel** — any authenticated user can read all tasks and cancel any task regardless of ownership. | security | `agent/task-routes.ts:122-180` | 1 hour |

### MEDIUM

| # | Finding | Source | File:Line | Effort |
|---|---------|--------|-----------|--------|
| M1 | Runtime restart loses all in-memory task results permanently | edge | `runtime/routes/tasks.ts:18-28` | Part of C1 fix |
| M2 | Auth derivation duplicated in 3 places (CLI, MCP, start.ts) | arch | `cli/agent-auth.ts:33`, `runtime/mcp/task-tools.ts:90` | 1 hour |
| M3 | No concurrency limit on task execution — unbounded Map growth | arch, security | `runtime/task-runner.ts:27` | 1 hour |
| M4 | Status query parameter not validated against TaskStatusSchema | arch, error, security | `agent/task-routes.ts:128` | 15 min |
| M5 | `cleanExpiredTasks` runs synchronously on every GET /tasks | arch, edge | `agent/task-routes.ts:124` | 30 min |
| M6 | `readTask` silently returns undefined for corrupt files — no logging | error | `core/task-storage.ts:26-36` | 15 min |
| M7 | AbortController registry leak on zombie sdkChat calls — no timeout | edge | `runtime/task-runner.ts:27,39-72` | 1 hour |
| M8 | Pending tasks survive reconciliation and persist forever | edge | `core/task-storage.ts:83-93` | 30 min |
| M9 | `task create` not in CLI MUTATING_COMMANDS set | arch | `cli/program.ts:45-58` | 5 min |
| M10 | Ephemeral result map FIFO eviction discards unread results in bursts | edge | `runtime/routes/tasks.ts:19-28` | Part of C1 fix |

### LOW

| # | Finding | Source | File:Line | Effort |
|---|---------|--------|-----------|--------|
| L1 | 32-bit task ID collision at ~65K tasks | edge, security | `agent/task-routes.ts:73` | 5 min |
| L2 | TOCTOU in `deleteTask` — `existsSync` then `unlinkSync` | edge | `core/task-storage.ts:57-62` | 15 min |
| L3 | Synchronous file I/O in async Fastify handlers | edge | `core/task-storage.ts:20-54` | 2 hours |
| L4 | Runtime route tests use `setTimeout` for async coordination (flaky) | testing | `runtime/__tests__/routes/tasks.test.ts:93,122` | 30 min |
| L5 | `reconcileStaleTasks` runs during route registration, not `onReady` | arch | `agent/task-routes.ts:39` | 15 min |
| L6 | Stale dist artifacts from branch code in main's dist/ | security | `packages/*/dist/task-*.js` | 5 min |

### GOOD

| # | Finding | Source |
|---|---------|--------|
| G1 | Dependency direction is clean: core → service → agent/runtime → CLI. No circular deps. | arch |
| G2 | AbortController cancellation model is well-designed with proper registry cleanup. | arch, edge |
| G3 | Core storage tests are exemplary — real temp dirs, behavioral assertions, boundary conditions. | testing |
| G4 | All HTTP calls have explicit timeouts via AbortSignal.timeout(). | error |
| G5 | Auth infrastructure uses timing-safe comparison, HMAC domain separation, 0o600 file perms. | security |
| G6 | Error messages don't leak sensitive information (paths, tokens, internal state). | security |
| G7 | Input validation with Zod at API boundaries, isValidName for bot names. | security |
| G8 | File sizes all under 200 lines — well within 350 LOC limit. | arch |

---

## Edge Case Risk Matrix

| # | Scenario | Likelihood | Impact | Risk | Component | File |
|---|----------|-----------|--------|------|-----------|------|
| 1 | Task permanently stuck as "working" | **Certain** | High | **CRITICAL** | agent/runtime | task-routes.ts, tasks.ts |
| 2 | Path traversal reads arbitrary .json files | Low | High | HIGH | core/agent | task-storage.ts:10 |
| 3 | Cancel overwritten by concurrent proxy write | Medium | High | HIGH | agent | task-routes.ts:75-118 |
| 4 | Runtime restart loses all results | Medium | High | HIGH | runtime | tasks.ts:18-28 |
| 5 | x-mecha-source spoofed to bypass ACL | Medium | Medium | MEDIUM | agent | task-routes.ts:59 |
| 6 | 100+ burst evicts unread results | Medium | Medium | MEDIUM | runtime | tasks.ts:19-28 |
| 7 | Zombie tasks leak AbortControllers | Low | Medium | MEDIUM | runtime | task-runner.ts:27 |
| 8 | Pending tasks never cleaned | Medium | Low | MEDIUM | core | task-storage.ts:83 |
| 9 | Sync I/O blocks event loop at scale | Medium | Medium | MEDIUM | core | task-storage.ts:20-54 |
| 10 | Task ID collision at ~65K tasks | Low | Medium | LOW | agent | task-routes.ts:73 |

---

## Paranoid Verdict

**The single scariest thing:** Under normal, non-exceptional operation — not a crash, not a race condition — every single task that runs to completion has its result silently lost. The agent permanently lies about task state. This isn't an edge case; it's the guaranteed behavior of every task. The system structurally cannot deliver accurate lifecycle state to any consumer.

---

## Top 3 Actions

1. **Add result callback from runtime to agent** (C1) — Without this, the feature doesn't work. The runtime needs to POST task results back to the agent's `/tasks/:id` (new PATCH route) when execution completes. **Confidence: High.**

2. **Wire MCP tools into MCP server** (H1) — One-line fix: import `TASK_TOOLS` and `handleTaskTool` in `mcp/server.ts`, add to `allTools`, add dispatch case. Without this, bots can't delegate to each other. **Confidence: High.**

3. **Sanitize task ID for path traversal** (H2) — Add `realpath` check or regex validation on task IDs in `taskPath()`. Prevents file reads outside `~/.mecha/tasks/`. **Confidence: High.**

---

## Fixing Plan

### Phase 1: Critical fixes (do immediately)

**C1: Add result callback from runtime to agent**
- **Fix:** When `startTask` callback fires in `runtime/routes/tasks.ts`, POST the result to the agent server's new `PATCH /tasks/:id` endpoint (add to `agent/task-routes.ts`). The runtime already knows the agent URL (from `agentPort`/`agentApiKey` in server opts).
- **Effort:** 1-2 days (new route + callback + tests)
- **Files:** `runtime/routes/tasks.ts`, `agent/task-routes.ts`, tests for both

### Phase 2: High-priority fixes (this sprint)

**H1: Wire MCP tools into MCP server**
- **Fix:** In `runtime/mcp/server.ts`: import `TASK_TOOLS`/`handleTaskTool`, add to `allTools`, add `isTaskTool` set, add dispatch case.
- **Effort:** 1 hour
- **Files:** `runtime/mcp/server.ts`

**H2: Sanitize task ID for path traversal**
- **Fix:** In `core/task-storage.ts`, validate `taskPath` result stays within dir: `if (!resolve(p).startsWith(resolve(dir) + sep)) throw`.
- **Effort:** 30 min
- **Files:** `core/task-storage.ts`, test for traversal

**H3: Fix TOCTOU race on cancel**
- **Fix:** Read task from disk inside the cancel handler, check status, write cancel atomically. Don't reuse the in-memory `task` object from the proxy closure.
- **Effort:** 2 hours
- **Files:** `agent/task-routes.ts`

**H4: Derive source from auth context for local requests**
- **Fix:** In the agent auth hook, attach the authenticated identity to the request. Use it as source instead of trusting the header.
- **Effort:** 2 hours
- **Files:** `agent/auth.ts`, `agent/task-routes.ts`

**H5: Add try/catch to handleTaskTool**
- **Fix:** Wrap the entire switch in try/catch, return `{ isError: true }` on network errors.
- **Effort:** 30 min
- **Files:** `runtime/mcp/task-tools.ts`

**H6: Catch plain Error in CLI error handler**
- **Fix:** Add `} else if (err instanceof Error) { formatter.error(err.message) }` to the catch chain.
- **Effort:** 30 min
- **Files:** `cli/error-handler.ts`

**H7: Test the proxy logic**
- **Fix:** Spin up a mock runtime server in tests, configure bot config to point at it, verify task transitions on disk.
- **Effort:** 2 hours
- **Files:** `agent/__tests__/task-routes.test.ts`

**H8: Add ACL checks on task read/cancel**
- **Fix:** Check that caller is task source, target, or admin before allowing read/cancel.
- **Effort:** 1 hour
- **Files:** `agent/task-routes.ts`

### Phase 3: Medium-priority improvements (next sprint)

**M2:** Extract HMAC derivation to `@mecha/core` shared function → `core/auth-derive.ts`
**M3:** Add `MAX_CONCURRENT_TASKS` check in `startTask` → `runtime/task-runner.ts`
**M4:** Validate status param with `TaskStatusSchema.safeParse` → `agent/task-routes.ts:128`
**M5:** Debounce `cleanExpiredTasks` to once per minute → `agent/task-routes.ts:124`
**M6:** Log corrupt file warnings in `readTask` → `core/task-storage.ts:32`
**M7:** Add task execution timeout (configurable, default 10 min) → `runtime/task-runner.ts`
**M8:** Reconcile stale "pending" tasks too → `core/task-storage.ts:83-93`
**M9:** Add `task create`/`task cancel` to MUTATING_COMMANDS → `cli/program.ts`

### Phase 4: Low-priority cleanup (when touching these files)

**L1:** Increase to `randomBytes(8)` → `agent/task-routes.ts:73`
**L2:** Use try/catch instead of existsSync → `core/task-storage.ts:57-62`
**L3:** Consider async file I/O (future optimization) → `core/task-storage.ts`
**L4:** Replace setTimeout with polling loops in tests → `runtime/__tests__/routes/tasks.test.ts`
**L5:** Move reconciliation to `onReady` hook → `agent/task-routes.ts:39`
**L6:** Clean stale dist artifacts → `packages/*/dist/task-*.js`

### Dependency Graph

- H1-H8 can all be done in parallel
- M2, M3, M4, M5, M6, M7, M8, M9 are independent
- C1 must be done first — H7 (proxy tests) depends on C1's PATCH route design

### Estimated Total Effort

- Phase 1: 2 days
- Phase 2: 1.5 days
- Phase 3: 1 day
- Phase 4: 0.5 days (opportunistic)
- **Total: 5 days**
