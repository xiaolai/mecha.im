---
title: "@mecha/agent"
description: API reference for @mecha/agent — agent HTTP server for bot queries, session authentication, request signature verification, and meter daemon lifecycle.
---

# @mecha/agent

[[toc]]

The `@mecha/agent` package provides the agent HTTP server that receives bot queries from the local CLI, dashboard, and remote mesh nodes. It handles session-based and bearer token authentication, Ed25519 request signature verification with nonce replay protection, and meter daemon lifecycle management.

## Barrel Exports

| Export | Kind | Source |
|--------|------|--------|
| `createAgentServer` | Function | `server.ts` |
| `AgentServerOptions` | Type | `server.ts` |
| `startMeterDaemon` | Function | `meter.ts` |
| `deriveSessionKey` | Function | `session.ts` |
| `createSessionToken` | Function | `session.ts` |
| `validateSessionToken` | Function | `session.ts` |
| `createAuthHook` | Function | `auth.ts` |
| `createAuthContext` | Function | `auth.ts` |
| `verifyRequestSignature` | Function | `auth.ts` |
| `AuthConfig` | Type | `auth.ts` |
| `AuthContext` | Type | `auth.ts` |
| `registerTaskRoutes` | Function | `task-routes.ts` |
| `TaskRouteOpts` | Type | `task-routes.ts` |

## `createAgentServer(opts)`

Creates a configured Fastify HTTP server with authentication hooks, bot query forwarding, and optional SPA static file serving. Returns an **unstarted** Fastify instance -- call `.listen()` to bind.

```ts
import { createAgentServer } from "@mecha/agent";

const app = createAgentServer({
  port: 7660,
  auth: { totpSecret: "JBSWY3DPEHPK3PXP", apiKey: "mesh-bearer-token" },
  processManager,
  acl,
  mechaDir: "/Users/you/.mecha",
  nodeName: "alice",
});

await app.listen({ port: 7660, host: "127.0.0.1" });
```

### `AgentServerOptions`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `port` | `number` | Yes | Port the server will bind to (conventionally `7660`; use `0` for a random available port) |
| `auth` | `AuthConfig` | Yes | Authentication configuration (TOTP secret and/or API key) |
| `processManager` | `ProcessManager` | Yes | Process manager instance from `@mecha/process` |
| `acl` | `AclEngine` | Yes | Access control engine from `@mecha/core` |
| `mechaDir` | `string` | Yes | Path to the mecha configuration directory (e.g., `~/.mecha`) |
| `nodeName` | `string` | Yes | Local node name for mesh identification |
| `startedAt` | `string` | No | ISO timestamp of when the server started |
| `publicIp` | `string` | No | Public IP address of this node |
| `ptySpawnFn` | `unknown` | No | PTY spawn function -- stored for future terminal routes |
| `spaDir` | `string` | No | Path to built SPA assets. When set, registers `@fastify/static` and serves the SPA shell for unmatched routes |

### HTTP Routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/healthz` | None | Liveness check. Returns `{ status: "ok" }` |
| `POST` | `/bots/:botName/query` | Required | Forward a query to a local bot process |
| `POST` | `/tasks` | Required | Create a task (see [Task Routes](#task-routes)) |
| `GET` | `/tasks` | Required | List tasks (see [Task Routes](#task-routes)) |
| `GET` | `/tasks/:id` | Required | Get a single task (see [Task Routes](#task-routes)) |
| `PATCH` | `/tasks/:id` | Required | Update task result (see [Task Routes](#task-routes)) |
| `POST` | `/tasks/:id/cancel` | Required | Cancel a task (see [Task Routes](#task-routes)) |

> **Note:** `mecha node health` also fetches `GET /bots` to obtain a bot count. This route is provided by the SPA static handler when `spaDir` is set, or returns 404 otherwise. The health check treats failures gracefully.

### `POST /bots/:botName/query`

Forwards a message to the named bot's SDK process and returns the response.

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `message` | `string` | Yes | The query message to send to the bot |
| `sessionId` | `string` | No | Session ID for conversation continuity |
| `requestId` | `string` | No | Client-generated request ID for correlation |

**Success response** (`200`):

```json
{
  "response": "The bot's reply text",
  "sessionId": "session-id-or-null"
}
```

**Error responses:**

| Status | Condition |
|--------|-----------|
| `400` | Invalid bot name or missing/empty message |
| `401` | Authentication failed (invalid bearer token or session cookie) |
| `403` | ACL denied the query capability for the requesting source |
| `404` | Bot not found (no `config.json` in bot directory) |
| `502` | Forwarding to the bot process failed |

**ACL enforcement:** The route reads the `X-Mecha-Source` header to identify the caller (e.g., `"coder@alice"`). If the header is absent, the source defaults to `"admin"`. The ACL engine checks whether the source has the `query` capability for the target bot.

**Signature verification:** If `X-Mecha-Signature`, `X-Mecha-Timestamp`, and `X-Mecha-Nonce` headers are present, the request is verified against the sender node's Ed25519 public key. See [Request Signature Verification](#verifyRequestSignature) below.

## Authentication

The agent server supports two authentication mechanisms, evaluated in order:

1. **Bearer token** -- `Authorization: Bearer <apiKey>` for mesh node-to-node routing
2. **Session cookie** -- `mecha-session=<token>` for dashboard and CLI access

If neither `totpSecret` nor `apiKey` is configured, all requests are allowed. The `/healthz` endpoint always skips authentication.

### `AuthConfig`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `totpSecret` | `string` | No | TOTP secret string. When set, enables session cookie authentication |
| `apiKey` | `string` | No | API key for Bearer token authentication (mesh routing) |

At least one of `totpSecret` or `apiKey` should be provided for production use.

### `AuthContext`

| Field | Type | Description |
|-------|------|-------------|
| `config` | `AuthConfig` | The authentication configuration |
| `mechaDir` | `string` | Path to the mecha configuration directory |
| `nonces` | `NonceSet` | Bounded set (max 10,000 entries) for nonce replay protection |

### `createAuthContext(config, mechaDir)`

Creates an `AuthContext` with an initialized nonce set. Used internally by `createAgentServer` and can be used standalone for testing.

```ts
import { createAuthContext } from "@mecha/agent";

const authCtx = createAuthContext(
  { totpSecret: "JBSWY3DPEHPK3PXP", apiKey: "mesh-key" },
  "/Users/you/.mecha",
);
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `config` | `AuthConfig` | Authentication configuration |
| `mechaDir` | `string` | Path to mecha directory (used for node public key lookups) |

**Returns:** `AuthContext`

### `createAuthHook(authCtx)`

Creates a Fastify `preHandler` hook that enforces authentication on all routes except `/healthz`.

```ts
import { createAuthHook, createAuthContext } from "@mecha/agent";

const authCtx = createAuthContext(config, mechaDir);
app.addHook("preHandler", createAuthHook(authCtx));
```

**Authentication flow:**

1. If the route is `/healthz`, skip authentication
2. If neither `totpSecret` nor `apiKey` is configured, allow all requests
3. Check `Authorization: Bearer <token>` header -- if it matches `apiKey`, allow
4. Check `mecha-session` cookie -- if it passes TOTP validation, allow
5. Otherwise, respond with `401 Unauthorized`

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `authCtx` | `AuthContext` | Authentication context created by `createAuthContext` |

**Returns:** `(req: FastifyRequest, reply: FastifyReply) => Promise<void>` -- a Fastify preHandler hook function.

## Session Token Functions

Session authentication uses HMAC-SHA256 tokens derived from a TOTP secret. The session key is derived via a labeled HMAC, and tokens are generated for counter values within a sliding window.

### `deriveSessionKey(totpSecret)`

Derives a 256-bit session key from a TOTP secret string using HMAC-SHA256 with the label `"mecha-session-key"`.

```ts
import { deriveSessionKey } from "@mecha/agent";

const key = deriveSessionKey("JBSWY3DPEHPK3PXP");
// key: Uint8Array (32 bytes)
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `totpSecret` | `string` | The TOTP secret string |

**Returns:** `Uint8Array` -- 32-byte session key.

### `createSessionToken(sessionKey, counter)`

Creates an HMAC-SHA256 session token for a given counter value, returned as a hex string.

```ts
import { deriveSessionKey, createSessionToken } from "@mecha/agent";

const key = deriveSessionKey("JBSWY3DPEHPK3PXP");
const token = createSessionToken(key, 0);
// token: "a1b2c3..." (64-char hex string)
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `sessionKey` | `Uint8Array` | Session key from `deriveSessionKey` |
| `counter` | `number` | Counter value for the token |

**Returns:** `string` -- hex-encoded HMAC-SHA256 token.

### `validateSessionToken(totpSecret, token)`

Validates a session token against a TOTP secret by checking counter values 0 through 4 (a sliding window of 5 values). Uses timing-safe comparison to prevent timing attacks.

```ts
import { validateSessionToken } from "@mecha/agent";

const isValid = validateSessionToken("JBSWY3DPEHPK3PXP", "a1b2c3...");
// isValid: true | false
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `totpSecret` | `string` | The TOTP secret string |
| `token` | `string` | Hex-encoded session token to validate |

**Returns:** `boolean` -- `true` if the token matches any counter in the window.

## Request Signature Verification

### `verifyRequestSignature(req, rawBody, authCtx)` {#verifyRequestSignature}

Verifies an Ed25519 request signature for mesh node-to-node communication. Signature verification is optional -- if no signature headers are present, the function returns `null` (no error). When any signature header is present, all three must be provided.

```ts
import { verifyRequestSignature, createAuthContext } from "@mecha/agent";

const authCtx = createAuthContext(config, mechaDir);
const rawBody = JSON.stringify(requestBody);
const error = verifyRequestSignature(req, rawBody, authCtx);

if (error) {
  // error is a descriptive string like "Timestamp expired or invalid"
  reply.status(401).send({ error });
}
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `req` | `FastifyRequest` | The incoming Fastify request |
| `rawBody` | `string` | The raw (serialized) request body used to compute the signature |
| `authCtx` | `AuthContext` | Authentication context with nonce set and mecha directory |

**Returns:** `string | null` -- `null` if valid or no signature headers present; an error message string if verification fails.

**Signature headers** (all three required, or none — partial sets are rejected):

| Header | Description |
|--------|-------------|
| `X-Mecha-Timestamp` | Unix timestamp in milliseconds. Must be within 5 minutes of server time |
| `X-Mecha-Nonce` | Unique request nonce. Rejected if already seen (bounded set of 10,000) |
| `X-Mecha-Signature` | Base64-encoded Ed25519 signature over the canonical envelope |

`X-Mecha-Source` is read independently (defaults to `"admin"` when absent). It identifies the sender in `bot@node` format (e.g., `"coder@alice"`) and is used for ACL checks and as part of the signed envelope.

**Canonical envelope format:**

The signed data is constructed as a newline-delimited string:

```
{METHOD}\n{PATH}\n{SOURCE}\n{TIMESTAMP}\n{NONCE}\n{RAW_BODY}
```

For example:

```
POST\n/bots/helper/query\ncoder@alice\n1679900000000\nabc123\n{"message":"hello"}
```

**Verification steps:**

1. If no signature headers are present, return `null` (skip verification)
2. If only some signature headers are present, return `"Incomplete signature headers"`
3. Validate timestamp is within 5-minute window
4. Check nonce has not been seen before (replay protection)
5. Extract node name from `X-Mecha-Source` header (part after `@`)
6. Look up the node's Ed25519 public key from `nodes.json` via `readNodes(mechaDir)`
7. Construct the canonical envelope and verify the signature
8. If valid, mark the nonce as used and return `null`

**Possible error strings:**

| Error | Cause |
|-------|-------|
| `"Incomplete signature headers"` | Some but not all signature headers present |
| `"Timestamp expired or invalid"` | Timestamp outside 5-minute window or not a number |
| `"Nonce already used"` | Replay attack detected |
| `"Cannot verify signature: no node in source"` | `X-Mecha-Source` missing `@node` portion |
| `"Cannot verify signature: unknown node or missing public key"` | Node not found in `nodes.json` |
| `"Invalid signature"` | Ed25519 signature verification failed |

## `startMeterDaemon(mechaDir, port?)`

Starts the meter proxy daemon in-process. The meter daemon is an HTTP proxy that intercepts Anthropic API calls to track token usage and cost. This is a convenience wrapper around `@mecha/meter`'s `startDaemon`.

```ts
import { startMeterDaemon } from "@mecha/agent";

const handle = await startMeterDaemon("/Users/you/.mecha");
console.log(`Meter running on port ${handle.info.port}, pid ${handle.info.pid}`);

// Later: shut down
await handle.close();
```

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `mechaDir` | `string` | -- | Path to the mecha configuration directory (e.g., `~/.mecha`) |
| `port` | `number` | `7600` | Port for the meter proxy to listen on |

**Returns:** `Promise<DaemonHandle>` -- resolves with the daemon handle.

**`DaemonHandle`** (from `@mecha/meter`):

| Field | Type | Description |
|-------|------|-------------|
| `server` | `Server` | The underlying Node.js HTTP server |
| `info` | `ProxyInfo` | Runtime info (see below) |
| `close` | `() => Promise<void>` | Gracefully shuts down the meter daemon |

**`ProxyInfo`**:

| Field | Type | Description |
|-------|------|-------------|
| `port` | `number` | Port the meter daemon is listening on |
| `pid` | `number` | Process ID |
| `required` | `boolean` | Whether the meter daemon is required (always `true` when started via `startMeterDaemon`) |
| `startedAt` | `string` | ISO timestamp of when the daemon started |

**Throws** if the meter daemon is already running or the port is busy.

## Task Routes

The agent server acts as the persistent task store and proxy layer for the task protocol. Tasks are stored as JSON files in `~/.mecha/tasks/` and execution is proxied to the target bot's runtime process.

```mermaid
sequenceDiagram
  participant CLI as CLI / MCP Tool
  participant Agent as Agent Server
  participant Runtime as Bot Runtime
  participant SDK as sdkChat (Claude)
  CLI->>Agent: POST /tasks
  Agent->>Agent: Write task JSON (pending)
  Agent-->>CLI: 201 {id, status: pending}
  Agent->>Runtime: POST /api/tasks (async)
  Runtime->>Runtime: startTask (AbortController)
  Runtime-->>Agent: 202 Accepted
  Agent->>Agent: Update task (working)
  Runtime->>SDK: query()
  SDK-->>Runtime: result
  Runtime->>Agent: PATCH /tasks/:id (completed + result)
  Agent->>Agent: Update task JSON
  CLI->>Agent: GET /tasks/:id
  Agent-->>CLI: {status: completed, result: "..."}
```

**Source:** `packages/agent/src/task-routes.ts`

### Task Route Summary

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/tasks` | Required | Create a task and proxy to bot runtime |
| `GET` | `/tasks` | Required | List tasks (filtered by caller ownership) |
| `GET` | `/tasks/:id` | Required | Get a single task |
| `PATCH` | `/tasks/:id` | Required | Update task result (runtime callback) |
| `POST` | `/tasks/:id/cancel` | Required | Cancel a task |

All task routes require authentication (Bearer token or session cookie). Non-admin callers only see tasks where they are the `source` or `target`.

### `POST /tasks`

Create a new task and proxy it to the target bot's runtime process.

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `target` | `string` | Yes | Bot name to execute the task |
| `message` | `string` | Yes | Task instruction/prompt |

**ACL enforcement:** The `X-Mecha-Source` header identifies the caller (defaults to `"admin"`). The ACL engine checks the `query` capability from source to target.

**Success response** (`201`):

```json
{
  "id": "task-a1b2c3d4e5f6g7h8",
  "status": "pending"
}
```

The task is created with `pending` status and written to disk. The agent then fires an async proxy request to the bot runtime's `POST /api/tasks` endpoint. If the runtime accepts, the status transitions to `working`; if the runtime rejects or is unreachable, the status transitions to `failed`.

**Error responses:**

| Status | Condition |
|--------|-----------|
| `400` | Invalid input (Zod validation) or invalid bot name |
| `403` | ACL denied the `query` capability |
| `404` | Target bot not found (no `config.json`) |

### `GET /tasks`

List tasks with optional filters. Results are sorted by `updatedAt` descending. Expired tasks (older than 7 days in a terminal state) are cleaned up opportunistically (at most once per minute).

**Query parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `target` | `string?` | Filter by target bot name |
| `status` | `string?` | Filter by status (`pending`, `working`, `completed`, `failed`, `cancelled`) |

**Ownership filtering:** Non-admin callers only see tasks where `source` or `target` matches their identity.

**Success response** (`200`): Array of `Task` objects.

**Error responses:**

| Status | Condition |
|--------|-----------|
| `400` | Invalid status value |

### `GET /tasks/:id`

Get a single task by ID.

**Success response** (`200`): A `Task` object.

**Error responses:**

| Status | Condition |
|--------|-----------|
| `403` | Caller is not the task source, target, or admin |
| `404` | Task not found |

### `PATCH /tasks/:id`

Update a task with execution results. This endpoint is intended for the bot runtime callback -- only the executing bot (identified by a source starting with `<target>@`) or admin can update results.

**Request body** (all fields optional):

| Field | Type | Description |
|-------|------|-------------|
| `status` | `string` | New status (`completed`, `failed`, `cancelled`) |
| `result` | `string` | Task result text |
| `error` | `string` | Error message |
| `sessionId` | `string` | SDK session ID used during execution |
| `durationMs` | `number` | Execution duration in milliseconds |
| `costUsd` | `number` | Execution cost in USD |

**Success response** (`200`):

```json
{ "updated": true }
```

**Error responses:**

| Status | Condition |
|--------|-----------|
| `400` | Invalid status value |
| `403` | Caller is not the executing bot or admin |
| `404` | Task not found |

### `POST /tasks/:id/cancel`

Cancel a pending or working task. The agent proxies the cancel request to the bot's runtime, then marks the task as `cancelled` in storage.

**Success response** (`200`):

```json
{ "cancelled": true }
```

**Error responses:**

| Status | Condition |
|--------|-----------|
| `403` | Caller is not the task source or admin |
| `404` | Task not found |
| `409` | Task is already in a terminal state (`completed`, `failed`, `cancelled`) |

### Startup Reconciliation

On startup, the agent server reconciles stale tasks via `reconcileStaleTasks()`. Any tasks left in `working` or `pending` status from a previous agent process are marked as `failed` with an appropriate error message.

## See also

- [@mecha/server](/reference/api/server) -- Rendezvous server, WebSocket signaling, relay, and gossip
- [@mecha/core](/reference/api/core) -- Core utilities, ACL engine, node registry, and identity
- [@mecha/meter](/reference/api/meter) -- Meter proxy daemon and token usage tracking
- [@mecha/process](/reference/api/process) -- Process manager for bot lifecycle
- [Mesh Networking](/features/mesh-networking) -- User guide for multi-node mesh setup
- [CLI Reference](/reference/cli/) -- CLI commands that interact with the agent server
