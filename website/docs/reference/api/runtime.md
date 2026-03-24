---
title: "@mecha/runtime"
description: API reference for @mecha/runtime — per-bot Fastify server with sessions, chat, MCP tools, scheduling, and authentication.
---

# @mecha/runtime

[[toc]]

The `@mecha/runtime` package provides the Fastify-based HTTP server that runs inside each bot process. It is the per-bot runtime — one instance per spawned agent.

## Barrel Exports

| Export | Kind | Source |
|--------|------|--------|
| `createSessionManager` | Function | `session-manager.ts` |
| `SessionManager` | Type | `session-manager.ts` |
| `SessionMeta` | Type | `session-manager.ts` |
| `TranscriptEvent` | Type | `session-manager.ts` |
| `Session` | Type | `session-manager.ts` |
| `createAuthHook` | Function | `auth.ts` |
| `registerHealthRoutes` | Function | `routes/health.ts` |
| `HealthRouteOpts` | Type | `routes/health.ts` |
| `registerSessionRoutes` | Function | `routes/sessions.ts` |
| `registerChatRoutes` | Function | `routes/chat.ts` |
| `HttpChatFn` | Type | `routes/chat.ts` |
| `registerMcpRoutes` | Function | `mcp/server.ts` |
| `McpRouteOpts` | Type | `mcp/server.ts` |
| `MeshRouter` | Type | `mcp/mesh-tools.ts` |
| `parseRuntimeEnv` | Function | `env.ts` |
| `RuntimeEnvData` | Type | `env.ts` |
| `createServer` | Function | `server.ts` |
| `CreateServerOpts` | Type | `server.ts` |
| `ServerResult` | Type | `server.ts` |
| `createScheduleEngine` | Function | `scheduler.ts` |
| `ScheduleEngine` | Type | `scheduler.ts` |
| `ChatFn` | Type | `scheduler.ts` |
| `CreateScheduleEngineOpts` | Type | `scheduler.ts` |
| `ScheduleLog` | Type | `scheduler.ts` |
| `executeRun` | Function | `schedule-runner.ts` |
| `RunDeps` | Type | `schedule-runner.ts` |
| `registerScheduleRoutes` | Function | `routes/schedule.ts` |
| `sdkChat` | Function | `sdk-chat.ts` |
| `createChatFn` | Function | `sdk-chat.ts` |
| `SdkChatOpts` | Type | `sdk-chat.ts` |
| `startTask` | Function | `task-runner.ts` |
| `cancelTask` | Function | `task-runner.ts` |
| `isTaskRunning` | Function | `task-runner.ts` |
| `runningTaskCount` | Function | `task-runner.ts` |
| `TaskRunResult` | Type | `task-runner.ts` |
| `TaskResultCallback` | Type | `task-runner.ts` |
| `registerTaskRoutes` | Function | `routes/tasks.ts` |
| `createWorkflowScheduler` | Function | `workflow-scheduler.ts` |
| `WorkflowScheduler` | Type | `workflow-scheduler.ts` |
| `WorkflowSchedulerOpts` | Type | `workflow-scheduler.ts` |
| `WorkflowScheduleInfo` | Type | `workflow-scheduler.ts` |

## Runtime API Routes

Each bot exposes these HTTP endpoints (localhost only):

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/healthz` | Health check (no auth required) |
| `GET` | `/info` | Runtime info (name, port, uptime, memory) |
| `POST` | `/api/chat` | Send a message via Claude Agent SDK (returns JSON: `response`, `sessionId`, `durationMs`, `costUsd`) |
| `GET` | `/api/sessions` | List all sessions |
| `GET` | `/api/sessions/:id` | Get session transcript |
| `DELETE` | `/api/sessions/:id` | Delete a session |
| `GET` | `/api/schedules` | List schedules |
| `POST` | `/api/schedules` | Create a schedule |
| `DELETE` | `/api/schedules/:id` | Remove a schedule |
| `POST` | `/api/schedules/:id/pause` | Pause a schedule |
| `POST` | `/api/schedules/:id/resume` | Resume a schedule |
| `POST` | `/api/schedules/:id/run` | Trigger a schedule immediately |
| `POST` | `/api/schedules/_pause-all` | Pause all schedules |
| `POST` | `/api/schedules/_resume-all` | Resume all schedules |
| `GET` | `/api/schedules/:id/history` | Schedule run history (supports `?limit=N`) |
| `GET` | `/api/events` | SSE stream of real-time bot activity events (max 6 connections) |
| `GET` | `/api/events/snapshot` | Current activity state snapshot (JSON) |
| `POST` | `/api/tasks` | Accept and execute a task (see [Task Execution](#task-execution)) |
| `POST` | `/api/tasks/:id/cancel` | Cancel a running task (see [Task Execution](#task-execution)) |
| `GET` | `/api/tasks/:id/status` | Check task execution status (see [Task Execution](#task-execution)) |
| `POST` | `/mcp` | JSON-RPC MCP endpoint |

All routes except `/healthz` require `Authorization: Bearer <token>` (the token from `config.json`). Authentication uses timing-safe comparison via `safeCompare`.

## `createServer(opts): ServerResult`

Creates a fully configured Fastify server for a bot, wiring up authentication, session management, scheduling, MCP tools, and all HTTP routes.

```ts
import { createServer } from "@mecha/runtime";

const { app, scheduler } = createServer({
  botName: "researcher",
  port: 7700,
  authToken: "secret-token",
  projectsDir: "/Users/you/.mecha/researcher/.claude/projects/-Users-you-workspace",
  workspacePath: "/Users/you/workspace",
  mechaDir: "/Users/you/.mecha",
  botDir: "/Users/you/.mecha/researcher",
  chatFn: async (prompt) => {
    // Send prompt to Claude Agent SDK, return result
    return { durationMs: 1200 };
  },
});

await app.listen({ port: 7700, host: "127.0.0.1" });
```

**`CreateServerOpts`**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `botName` | `string` | Yes | Name of the bot (e.g., `"researcher"`) |
| `port` | `number` | Yes | Port the server binds to |
| `authToken` | `string` | Yes | Bearer token for request authentication |
| `projectsDir` | `string` | Yes | Path to the workspace-specific Claude projects directory |
| `workspacePath` | `string` | Yes | Absolute path to the bot's workspace on disk |
| `mechaDir` | `string` | No | Path to `~/.mecha` (enables mesh tools) |
| `botDir` | `string` | No | Path to the bot root directory (enables scheduler) |
| `systemPrompt` | `string` | No | Full system prompt override (mutually exclusive with `appendSystemPrompt`) |
| `appendSystemPrompt` | `string` | No | Append to default system prompt (mutually exclusive with `systemPrompt`) |
| `scheduleChatFn` | `ChatFn` | No | Function to execute scheduled chat prompts (used by scheduler only) |
| `mcpServers` | `Record<string, unknown>` | No | MCP servers to connect the bot's Claude Code instance to |
| `agentPort` | `number` | No | Agent daemon port for mesh routing proxy (default: `7660`) |
| `agentApiKey` | `string` | No | Agent daemon API key for mesh routing proxy |

**`ServerResult`**

| Field | Type | Description |
|-------|------|-------------|
| `app` | `FastifyInstance` | The configured Fastify server (not yet listening) |
| `scheduler` | `ScheduleEngine \| undefined` | Schedule engine instance, present only when `botDir` is provided |

The scheduler is automatically started when the Fastify server emits `onReady` and stopped on `onClose`.

## `parseRuntimeEnv(env): RuntimeEnvData`

Parses and validates the environment variables required by the bot runtime process. Throws a descriptive error if any required variables are missing or invalid.

```ts
import { parseRuntimeEnv } from "@mecha/runtime";

const env = parseRuntimeEnv(process.env);
// env.MECHA_BOT_NAME, env.MECHA_PORT (number), etc.
```

**`RuntimeEnvData`**

| Variable | Type | Required | Description |
|----------|------|----------|-------------|
| `MECHA_BOT_NAME` | `string` | Yes | Name of the bot |
| `MECHA_PORT` | `number` | Yes | Port number (1--65535, parsed from string) |
| `MECHA_AUTH_TOKEN` | `string` | Yes | Bearer token for authentication |
| `MECHA_PROJECTS_DIR` | `string` | Yes | Path to the workspace-encoded projects directory |
| `MECHA_WORKSPACE` | `string` | Yes | Absolute path to the bot workspace |
| `MECHA_DIR` | `string` | No | Path to `~/.mecha` |
| `MECHA_SANDBOX_ROOT` | `string` | No | bot root directory (used by sandbox guard scripts; also enables scheduler) |

## `createAuthHook(token): FastifyHook`

Returns a Fastify `onRequest` hook that enforces Bearer token authentication on all routes except `/healthz`. Uses timing-safe string comparison to prevent timing attacks.

```ts
import { createAuthHook } from "@mecha/runtime";

app.addHook("onRequest", createAuthHook("my-secret-token"));
```

## Route Registration Functions

Each route group is registered independently, allowing selective composition:

| Function | Routes | Dependencies |
|----------|--------|--------------|
| `registerHealthRoutes(app, opts)` | `GET /healthz`, `GET /info` | `HealthRouteOpts` |
| `registerSessionRoutes(app, sm)` | `GET /api/sessions`, `GET /api/sessions/:id`, `DELETE /api/sessions/:id` | `SessionManager` |
| `registerChatRoutes(app, chatFn)` | `POST /api/chat` | `HttpChatFn` |
| `registerActivityEventsRoutes(app, opts)` | `GET /api/events` (SSE), `GET /api/events/snapshot` | `ActivityEventsRouteOpts` |
| `registerTaskRoutes(app, opts)` | `POST /api/tasks`, `POST /api/tasks/:id/cancel`, `GET /api/tasks/:id/status` | `TaskRouteOpts` |
| `registerScheduleRoutes(app, engine)` | All `/api/schedules/*` routes | `ScheduleEngine` |
| `registerMcpRoutes(app, opts)` | `POST /mcp` | `McpRouteOpts` |

**`HealthRouteOpts`**

| Field | Type | Description |
|-------|------|-------------|
| `botName` | `string` | bot name returned in `/info` |
| `port` | `number` | Port returned in `/info` |
| `startedAt` | `string` | ISO timestamp of server start |

The `/info` endpoint returns: `name`, `port`, `startedAt`, `uptime` (seconds), and `memoryMB` (RSS in megabytes).

**`ActivityEventsRouteOpts`**

| Field | Type | Description |
|-------|------|-------------|
| `activityEmitter` | `ActivityEmitter` | Emitter for real-time bot activity events |
| `botName` | `string` | Bot name to filter activity events |

The `GET /api/events` endpoint streams SSE events for real-time bot activity visualization (max 6 concurrent connections). `GET /api/events/snapshot` returns the current activity state as JSON.

**`TaskRouteOpts`**

| Field | Type | Description |
|-------|------|-------------|
| `sdkChatOpts` | `SdkChatOpts` | SDK chat configuration for task execution |
| `botName` | `string` | Bot name for agent server callbacks |
| `agentUrl` | `string?` | Agent server URL for result callbacks (e.g. `http://127.0.0.1:7660`) |
| `agentAuth` | `string?` | Bearer token for agent server authentication |

**`McpRouteOpts`**

| Field | Type | Description |
|-------|------|-------------|
| `workspacePath` | `string` | Root path for workspace file tools |
| `mechaDir` | `string?` | Enables mesh tools when provided with `botName` |
| `botName` | `string?` | bot identity for mesh operations |
| `router` | `MeshRouter?` | Router for cross-bot mesh queries |
| `agentPort` | `number?` | Agent daemon port for proxy routing when no direct router (default: `7660`) |
| `agentApiKey` | `string?` | Agent daemon API key for proxy authentication |

## `MeshRouter` Interface

The router interface for inter-bot communication via MCP mesh tools.

```ts
interface MeshRouter {
  routeQuery(
    source: string,    // Source bot name
    target: string,    // Target bot (name or name@node)
    message: string,   // Message to send
    sessionId?: string // Optional session for multi-turn
  ): Promise<ForwardResult>;
}
```

**`MeshOpts`**

| Field | Type | Description |
|-------|------|-------------|
| `mechaDir` | `string` | Path to `~/.mecha` (reads `discovery.json`) |
| `botName` | `string` | Identity of the calling bot |
| `router` | `MeshRouter?` | Routing implementation (undefined disables `mesh_query`) |

## SDK Chat

**Source:** `packages/runtime/src/sdk-chat.ts`

Wraps the Claude Agent SDK `query()` function to provide chat execution for both the `/api/chat` route handler and the schedule engine.

### `SdkChatOpts`

```ts
interface SdkChatOpts {
  workspacePath: string;
  settingSources?: readonly ("project" | "user" | "local")[];
  env?: Record<string, string | undefined>;
  systemPrompt?: string;
  appendSystemPrompt?: string;
  activityEmitter?: ActivityEmitter;
  botName?: string;
  mcpServers?: Record<string, unknown>;
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `workspacePath` | `string` | Yes | Bot's workspace directory -- passed as `cwd` to `query()` |
| `settingSources` | `readonly ("project" \| "user" \| "local")[]` | No | Which setting sources to load (CLAUDE.md, rules, skills, hooks). Defaults to `["project", "user"]` — bots load both project-level (`$CWD/.claude/`) and user-level (`$HOME/.claude/`) config |
| `env` | `Record<string, string \| undefined>` | No | Environment variables for the spawned claude process |
| `systemPrompt` | `string` | No | Full system prompt override (mutually exclusive with `appendSystemPrompt`) |
| `appendSystemPrompt` | `string` | No | Append to default system prompt (mutually exclusive with `systemPrompt`) |
| `activityEmitter` | `ActivityEmitter` | No | Activity emitter for real-time visualization events |
| `botName` | `string` | No | Bot name used as the activity event source |
| `mcpServers` | `Record<string, unknown>` | No | MCP servers to connect to |

### `sdkChat(opts, message, sessionId?, signal?)`

Execute a single SDK query and return the result. Used by both the `/api/chat` route handler and the schedule `chatFn`.

```ts
async function sdkChat(
  opts: SdkChatOpts,
  message: string,
  sessionId?: string,
  signal?: AbortSignal,
): Promise<{ response: string; sessionId: string; durationMs: number; costUsd: number }>
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `opts` | `SdkChatOpts` | Yes | SDK chat configuration |
| `message` | `string` | Yes | The prompt message to send |
| `sessionId` | `string` | No | Resume an existing session |
| `signal` | `AbortSignal` | No | Abort signal to cancel the query |

**Returns:** An object with `response` (the assistant's reply), `sessionId`, `durationMs`, and `costUsd`.

**Throws:** `Error` if the SDK query returns no result or returns an error result.

```ts
import { sdkChat } from "@mecha/runtime";

const result = await sdkChat(
  { workspacePath: "/home/alice/project" },
  "Summarize the README",
);
console.log(result.response);   // assistant's reply
console.log(result.sessionId);  // session ID for follow-up
console.log(result.costUsd);    // cost of this query
```

### `createChatFn(opts)`

Create a `ChatFn` compatible with the schedule engine from SDK chat options.

```ts
function createChatFn(opts: SdkChatOpts): ChatFn
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `opts` | `SdkChatOpts` | SDK chat configuration |

**Returns:** A `ChatFn` that executes prompts via `sdkChat` and returns `{ durationMs, error? }`.

```ts
import { createChatFn } from "@mecha/runtime";

const chatFn = createChatFn({ workspacePath: "/home/alice/project" });
const result = await chatFn("Generate the daily report");
console.log(result.durationMs); // execution time in ms
```

## Task Execution

The runtime provides in-process task execution via `sdkChat` with `AbortController`-based cancellation. Tasks are dispatched by the agent server and execute inside the bot's runtime process.

**Source:** `packages/runtime/src/task-runner.ts`, `packages/runtime/src/routes/tasks.ts`

### Runtime Task Routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/tasks` | Required | Accept and execute a task |
| `POST` | `/api/tasks/:id/cancel` | Required | Cancel a running task |
| `GET` | `/api/tasks/:id/status` | Required | Check task execution status |

#### `POST /api/tasks`

Accept a task for execution. The task runs asynchronously via `sdkChat`. On completion, the runtime calls back to the agent server's `PATCH /tasks/:id` endpoint with the result.

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `taskId` | `string` | Yes | Task ID assigned by the agent server |
| `message` | `string` | Yes | Task prompt to execute |

**Success response** (`202`):

```json
{ "accepted": true, "taskId": "task-a1b2c3d4e5f6g7h8" }
```

**Error responses:**

| Status | Condition |
|--------|-----------|
| `400` | Missing `taskId` or `message` |
| `429` | Concurrent task limit reached (max 10) or task ID already running |

#### `POST /api/tasks/:id/cancel`

Cancel a running task by aborting its `AbortController`.

**Success response** (`200`):

```json
{ "cancelled": true }
```

**Error responses:**

| Status | Condition |
|--------|-----------|
| `404` | Task not found or not currently running |

#### `GET /api/tasks/:id/status`

Check whether a task is currently running. If completed, returns the terminal result from the ephemeral in-memory cache (up to 100 recent results).

**Success response** (`200`) -- running:

```json
{ "running": true, "status": "working" }
```

**Success response** (`200`) -- completed:

```json
{ "running": false, "status": "completed", "result": "..." }
```

**Error responses:**

| Status | Condition |
|--------|-----------|
| `404` | Task not found (not running, no cached result) |

### Task Runner

The task runner manages concurrent task execution with admission control.

#### `startTask(taskId, sdkChatOpts, message, callback)`

Start executing a task asynchronously. Returns an admission result synchronously; the callback fires exactly once when the task reaches a terminal state.

```ts
import { startTask } from "@mecha/runtime";

const admission = startTask(
  "task-abc123",
  { workspacePath: "/home/alice/project" },
  "Analyze the codebase",
  (result) => {
    console.log(result.status);  // "completed" | "failed" | "cancelled"
    console.log(result.result);  // assistant's reply (on success)
  },
);

if (!admission.admitted) {
  console.error(admission.error);
}
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `taskId` | `string` | Unique task identifier |
| `sdkChatOpts` | `SdkChatOpts` | SDK chat configuration (workspace, env, settings) |
| `message` | `string` | Task prompt to execute |
| `callback` | `TaskResultCallback` | Called exactly once on completion, failure, or cancellation |

**Returns:** `{ admitted: boolean; error?: string }`

**Admission rejection reasons:**
- Concurrent task limit reached (max `MAX_CONCURRENT_TASKS` = 10)
- Task ID already running (duplicate)

**Execution timeout:** Each task is automatically aborted after 10 minutes (`TASK_TIMEOUT_MS`) to prevent zombie tasks.

#### `cancelTask(taskId)`

Cancel a running task by aborting its `AbortController`. Returns `true` if cancellation was initiated, `false` if the task was not found.

```ts
import { cancelTask } from "@mecha/runtime";

const cancelled = cancelTask("task-abc123");
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `taskId` | `string` | Task ID to cancel |

**Returns:** `boolean`

#### `isTaskRunning(taskId)`

Check if a task is currently executing.

| Parameter | Type | Description |
|-----------|------|-------------|
| `taskId` | `string` | Task ID to check |

**Returns:** `boolean`

#### `runningTaskCount()`

Get the number of currently executing tasks.

**Returns:** `number`

### `TaskRunResult`

Result reported back to the caller when a task completes or fails.

```ts
interface TaskRunResult {
  status: "completed" | "failed" | "cancelled";
  result?: string;
  sessionId?: string;
  durationMs?: number;
  costUsd?: number;
  error?: string;
}
```

| Field | Type | Description |
|-------|------|-------------|
| `status` | `"completed" \| "failed" \| "cancelled"` | Terminal task status |
| `result` | `string?` | Assistant's reply (on success) |
| `sessionId` | `string?` | SDK session ID used during execution |
| `durationMs` | `number?` | Execution duration in milliseconds |
| `costUsd` | `number?` | Execution cost in USD |
| `error` | `string?` | Error message (on failure) |

### `TaskResultCallback`

```ts
type TaskResultCallback = (result: TaskRunResult) => void;
```

Callback invoked exactly once when a task reaches a terminal state. Used by the runtime route handler to report results back to the agent server.

## Workflow Scheduler

The workflow scheduler monitors workflow YAML files with `trigger.schedule` definitions and executes them on a timer. It persists run state across restarts and auto-pauses workflows after repeated failures.

**Source:** `packages/runtime/src/workflow-scheduler.ts`

### `createWorkflowScheduler(opts)`

Create a timer-based scheduler that scans a directory for workflow YAML files with `trigger.schedule` and executes them on their configured interval or cron schedule.

```ts
import { createWorkflowScheduler } from "@mecha/runtime";

const scheduler = createWorkflowScheduler({
  workflowsDir: "/Users/you/.mecha/workflows",
  stateDir: "/Users/you/.mecha/workflow-state",
  runWorkflow: async (name) => {
    // Execute the named workflow
  },
});

scheduler.start();  // scan workflows and arm timers
scheduler.list();   // inspect scheduled workflows
scheduler.stop();   // clear all timers
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `opts` | `WorkflowSchedulerOpts` | Scheduler configuration (see below) |

**Returns:** `WorkflowScheduler`

### `WorkflowSchedulerOpts`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `workflowsDir` | `string` | Yes | Directory containing workflow YAML files to scan |
| `stateDir` | `string` | Yes | Directory for persisting scheduler state (lastRunAt, paused, error counts) |
| `runWorkflow` | `(name: string) => Promise<void>` | Yes | Callback to execute a workflow by name |
| `now` | `() => number` | No | Clock function for testability (defaults to `Date.now`) |
| `log` | `WorkflowSchedulerLog` | No | Structured logger callback (defaults to no-op) |

### `WorkflowScheduler`

Timer-based scheduler interface returned by `createWorkflowScheduler()`.

| Method | Signature | Description |
|--------|-----------|-------------|
| `start` | `() => void` | Scan workflow files, load persisted state, and arm timers for all non-paused workflows |
| `stop` | `() => void` | Clear all timers and stop scheduling |
| `list` | `() => WorkflowScheduleInfo[]` | List all scheduled workflows with their current state |
| `pause` | `(name: string) => boolean` | Pause a scheduled workflow. Returns `true` if it was running and is now paused |
| `resume` | `(name: string) => boolean` | Resume a paused workflow (resets consecutive error count). Returns `true` if it was paused and is now resumed |

**Behavior notes:**

- Workflows are auto-paused after 5 consecutive execution errors
- Resuming a workflow resets the consecutive error counter to 0
- State is persisted to `stateDir/<name>/state.json` after each execution and on pause/resume
- Timers use chained `setTimeout` (not `setInterval`) for drift-free scheduling
- Stale entries (workflows removed from the directory) are automatically cleaned up on `start()`

### `WorkflowScheduleInfo`

Information about a scheduled workflow, returned by `list()`.

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Workflow name (from the YAML `name` field) |
| `schedule` | `string` | Schedule expression (interval like `"every 5m"` or cron like `"0 9 * * *"`) |
| `paused` | `boolean` | Whether the workflow is currently paused |
| `lastRunAt` | `string?` | ISO 8601 timestamp of the last execution (undefined if never run) |
| `nextRunAt` | `string?` | ISO 8601 timestamp of the next scheduled execution (undefined if paused) |

### `WorkflowSchedulerLog`

```ts
type WorkflowSchedulerLog = (
  level: "info" | "warn" | "error",
  msg: string,
  data?: Record<string, unknown>,
) => void;
```

Structured logger callback for workflow scheduler events. Events include timer arming, workflow execution, errors, and auto-pause notifications.

## See also

- [@mecha/process](/reference/api/process) — Process management that spawns runtime instances
- [@mecha/core](/reference/api/core) — Shared types and utilities
- [API Reference](/reference/api/) — Route summary and package overview
