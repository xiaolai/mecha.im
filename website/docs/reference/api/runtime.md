---
title: "@mecha/runtime"
description: API reference for @mecha/runtime — per-bot Fastify server with sessions, chat, MCP tools, scheduling, and authentication.
---

# @mecha/runtime

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

## Runtime API Routes

Each bot exposes these HTTP endpoints (localhost only):

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/healthz` | Health check (no auth required) |
| `GET` | `/info` | Runtime info (name, port, uptime, memory) |
| `POST` | `/api/chat` | Send a message (stub — returns 501, chat handled by Agent SDK) |
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
| `chatFn` | `ChatFn` | No | Function to execute chat prompts (used by scheduler) |

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
| `registerChatRoutes(app)` | `POST /api/chat` | None (stub, returns 501) |
| `registerScheduleRoutes(app, engine)` | All `/api/schedules/*` routes | `ScheduleEngine` |
| `registerMcpRoutes(app, opts)` | `POST /mcp` | `McpRouteOpts` |

**`HealthRouteOpts`**

| Field | Type | Description |
|-------|------|-------------|
| `botName` | `string` | bot name returned in `/info` |
| `port` | `number` | Port returned in `/info` |
| `startedAt` | `string` | ISO timestamp of server start |

The `/info` endpoint returns: `name`, `port`, `startedAt`, `uptime` (seconds), and `memoryMB` (RSS in megabytes).

**`McpRouteOpts`**

| Field | Type | Description |
|-------|------|-------------|
| `workspacePath` | `string` | Root path for workspace file tools |
| `mechaDir` | `string?` | Enables mesh tools when provided with `botName` |
| `botName` | `string?` | bot identity for mesh operations |
| `router` | `MeshRouter?` | Router for cross-bot mesh queries |

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

## See also

- [@mecha/process](/reference/api/process) — Process management that spawns runtime instances
- [@mecha/core](/reference/api/core) — Shared types and utilities
- [API Reference](/reference/api/) — Route summary and package overview
