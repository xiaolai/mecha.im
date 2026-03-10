---
title: "@mecha/mcp-server"
description: API reference for @mecha/mcp-server — MCP tools, audit log, rate limiter, server factory, and transports.
---

# @mecha/mcp-server

[[toc]]

The `@mecha/mcp-server` package exposes the Mecha control plane as an [MCP](https://modelcontextprotocol.io/) server. See [MCP Server feature guide](/features/mcp-server) for usage and tool reference.

## Barrel Exports

| Export | Kind | Description |
|--------|------|-------------|
| `createMeshMcpServer` | Function | Creates a configured `McpServer` with all tools registered. |
| `createAuditLog` | Function | Creates an `AuditLog` bound to a mecha directory. |
| `createRateLimiter` | Function | Creates a sliding-window `RateLimiter` with optional custom limits. |
| `runStdio` | Function | Connects an `McpServer` to stdio transport. |
| `runHttp` | Function | Starts an HTTP server with session management and optional auth. |
| `startHttpDaemon` | Function | Starts the MCP HTTP server in non-blocking daemon mode. |
| `McpHttpHandle` | Type | Handle returned by `startHttpDaemon` for in-process usage. |
| `main` | Function | CLI entrypoint — validates options and starts the server. |
| `TOOL_ANNOTATIONS` | Constant | Read-only map of tool names to MCP annotation objects. |
| `MeshMcpContext` | Type | Context interface for server dependencies. |
| `ToolName` | Type | Union type of all tool name strings. |
| `AuditEntry` | Type | Shape of a single audit log entry. |
| `AuditLog` | Type | Interface for the audit log (append, read, clear). |
| `RateLimiter` | Type | Interface for the rate limiter (check, remaining). |
| `RateLimitConfig` | Type | Configuration for a rate limit bucket (`{ max, windowMs }`). |

## `MeshMcpContext`

The context interface for server dependencies:

```typescript
interface MeshMcpContext {
  mechaDir: string;                        // Path to ~/.mecha
  pm: ProcessManager;                      // bot process manager
  getNodes: () => NodeEntry[];             // Mesh node registry reader
  agentFetch: typeof agentFetch;           // HTTP client for remote agent calls
  mode: "read-only" | "query";            // Operating mode
  audit: AuditLog;                         // Audit log writer
  rateLimiter: RateLimiter;                // Per-tool rate limiter
  clientInfo?: { name: string; version: string }; // MCP client identification
}
```

## `createMeshMcpServer(ctx)`

Creates a configured `McpServer` instance:

1. Registers discovery tools (`mecha_list_nodes`, `mecha_list_bots`, `mecha_bot_status`, `mecha_discover`)
2. Registers session tools (`mecha_list_sessions`, `mecha_get_session`)
3. Registers workspace tools (`mecha_workspace_list`, `mecha_workspace_read`)
4. Conditionally registers query tools (`mecha_query`) only when `mode` is `query`

All tools are wrapped with `withAuditAndRateLimit`, which records every call to the audit log and enforces rate limits before executing the tool handler.

## `createAuditLog(mechaDir)`

Returns an `AuditLog` object for the `~/.mecha/audit.jsonl` file:

| Method | Signature | Description |
|--------|-----------|-------------|
| `append` | `(entry: AuditEntry) => void` | Appends an entry to the log file. Parameters exceeding 1024 bytes are truncated. |
| `read` | `(opts?: { limit?: number }) => AuditEntry[]` | Reads entries in reverse chronological order. Pass `limit` to cap results. |
| `clear` | `() => void` | Truncates the log file to zero bytes. |

**`AuditEntry`**

| Field | Type | Description |
|-------|------|-------------|
| `ts` | `string` | ISO 8601 timestamp. |
| `client` | `string` | Client identifier in `name/version` format (e.g., `claude-desktop/1.2.3`), or `unknown`. |
| `tool` | `string` | Tool name (e.g., `mecha_list_bots`). |
| `params` | `object` | Tool parameters. Truncated to 1024 bytes if larger. |
| `result` | `string` | One of `ok`, `error`, or `rate-limited`. |
| `error` | `string` | Error message, present only when `result` is `error`. |
| `durationMs` | `number` | Execution time in milliseconds. |

## `createRateLimiter(limits?)`

Creates a sliding-window rate limiter:

| Method | Signature | Description |
|--------|-----------|-------------|
| `check` | `(tool: string) => boolean` | Returns `true` if the request is allowed (and records it), `false` if rate-limited. |
| `remaining` | `(tool: string) => number` | Returns the number of remaining requests in the current window. |

Override default limits by passing a `Record<string, RateLimitConfig>`:

```typescript
import { createRateLimiter } from "@mecha/mcp-server";

const limiter = createRateLimiter({
  mecha_list_bots: { max: 60, windowMs: 60_000 },
  mecha_query:     { max: 10, windowMs: 60_000 },
});

limiter.check("mecha_list_bots"); // true (allowed)
limiter.remaining("mecha_list_bots"); // 59
```

## `TOOL_ANNOTATIONS`

Read-only map of tool names to MCP annotation objects:

```typescript
import { TOOL_ANNOTATIONS } from "@mecha/mcp-server";

// {
//   mecha_list_nodes:     { readOnlyHint: true,  destructiveHint: false },
//   mecha_list_bots:      { readOnlyHint: true,  destructiveHint: false },
//   mecha_bot_status:     { readOnlyHint: true,  destructiveHint: false },
//   mecha_discover:       { readOnlyHint: true,  destructiveHint: false },
//   mecha_list_sessions:  { readOnlyHint: true,  destructiveHint: false },
//   mecha_get_session:    { readOnlyHint: true,  destructiveHint: false },
//   mecha_query:          { readOnlyHint: false, destructiveHint: false },
//   mecha_workspace_list: { readOnlyHint: true,  destructiveHint: false },
//   mecha_workspace_read: { readOnlyHint: true,  destructiveHint: false },
// }
```

## `runStdio(server)`

Connects an `McpServer` instance to a `StdioServerTransport` from the MCP SDK for local clients (Claude Desktop, Cursor, Claude Code).

## `runHttp(server, opts)`

Starts an HTTP server with session management and optional Bearer token authentication. See [MCP Server Transports](/features/mcp-server#transports) for configuration options.

## `main(opts)`

CLI entrypoint for `mecha mcp serve`:

```typescript
await main({
  mode: "query",       // "read-only" | "query"
  transport: "stdio",  // "stdio" | "http"
  port: 7680,          // HTTP port (http transport only)
  host: "127.0.0.1",   // Bind address (http transport only)
  token: "my-secret",  // Bearer token (http transport only)
});
```

Validates all inputs (mode, transport, port range 1-65535), ensures `MECHA_DIR` exists, creates the process manager, audit log, and rate limiter, then starts the appropriate transport.

## `startHttpDaemon(createMcpServer, opts)`

Starts the MCP HTTP server in non-blocking daemon mode. Unlike `runHttp` (which blocks on process signals), this returns a handle with a `close()` method for in-process usage.

```ts
import { startHttpDaemon, createMeshMcpServer } from "@mecha/mcp-server";

const handle = await startHttpDaemon(
  () => createMeshMcpServer(ctx),
  { port: 7680, host: "127.0.0.1" },
);

console.log(`MCP server on port ${handle.port}`);

// Later: shut down
await handle.close();
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `createMcpServer` | `() => McpServer` | Yes | Factory function that creates a configured `McpServer` |
| `opts` | `HttpTransportOpts` | Yes | Transport options (port, host, token) |

**Returns:** `Promise<McpHttpHandle>`

### `McpHttpHandle`

Handle returned by `startHttpDaemon` for non-blocking in-process usage.

| Field | Type | Description |
|-------|------|-------------|
| `port` | `number` | Port the server is listening on |
| `host` | `string` | Bind address |
| `close` | `() => Promise<void>` | Gracefully shuts down the MCP HTTP server |

## See also

- [MCP Server](/features/mcp-server) — Feature guide with tool reference and usage examples
- [@mecha/server](/reference/api/server) — Rendezvous server for P2P peer discovery
- [API Reference](/reference/api/) — Route summary and package overview
