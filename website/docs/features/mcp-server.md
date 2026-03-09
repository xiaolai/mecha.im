---
title: MCP Server
description: Expose the Mecha control plane as an MCP server for Claude Desktop, Cursor, and Claude Code.
---

# MCP Server

[[toc]]

Mecha exposes its control plane as an [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) server, allowing any MCP-compatible client — Claude Desktop, Cursor, Claude Code — to discover, inspect, and query your bots.

## Quick Start

Generate the Claude Desktop configuration:

```bash
mecha mcp config
```

Copy the JSON output into your Claude Desktop `claude_desktop_config.json` file. Restart Claude Desktop — you'll see mecha's tools available in the tool picker.

## Operating Modes

The MCP server supports two modes:

| Mode | Tools Available | Use Case |
|------|----------------|----------|
| `read-only` | 8 discovery/inspection tools | Safe read-only access |
| `query` (default) | 9 tools (read-only + `mecha_query`) | Full interaction |

```bash
mecha mcp serve              # default: query mode
mecha mcp serve --mode read-only   # read-only mode
```

## Available Tools

### Discovery

| Tool | Description |
|------|-------------|
| `mecha_list_nodes` | List all mesh nodes with health status |
| `mecha_list_bots` | List bots (local or from a remote node) |
| `mecha_bot_status` | Get detailed status for a specific bot |
| `mecha_discover` | Find bots by tag or capability |

### Sessions

| Tool | Description |
|------|-------------|
| `mecha_list_sessions` | List sessions for a local bot |
| `mecha_get_session` | Get session detail with optional message content |

### Workspace

| Tool | Description |
|------|-------------|
| `mecha_workspace_list` | List files in a bot's workspace |
| `mecha_workspace_read` | Read a file from a bot's workspace |

### Query (query mode only)

| Tool | Description |
|------|-------------|
| `mecha_query` | Send a message to a bot and get a response |

## Tool Reference

Detailed parameter and return documentation for every tool.

### `mecha_list_nodes`

Lists all registered mesh nodes and checks their health by issuing a `/healthz` request.

**Parameters:** None.

**Returns:** One line per node in the format `<name>: <status> (<host>:<port>, <latency>)`. Status is `healthy`, `unreachable`, or `p2p (no http)` for managed nodes. Latency is reported in milliseconds or `n/a` if the node could not be reached.

```
my-server: healthy (10.0.0.5:7660, 12ms)
cloud-node: unreachable (192.168.1.100:7660, n/a)
p2p-peer: p2p (no http) (p2p:0, n/a)
```

### `mecha_list_bots`

Lists bots on the local machine or on a specified remote node.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `node` | `string` | No | Remote node name to query. Omit for local bots. |
| `limit` | `number` | No | Maximum number of results to return. |

**Returns:** One line per bot in the format `<name>: <state> (port <port>) [tags]`. State is `running`, `stopped`, or `error`.

```
alice: running (port 7700) [backend, api]
bob: stopped
```

### `mecha_bot_status`

Returns detailed status for a single bot, either local or remote.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `target` | `string` | Yes | bot name for local, or `name@node` for remote. |

**Returns:** Multi-line status report with name, state, PID, port, and workspace path. Remote targets return the raw JSON from the remote node's `/bots/<name>/status` endpoint.

```
Name: alice
State: running
PID: 12345
Port: 7700
Workspace: /home/user/my-project
```

### `mecha_discover`

Finds bots matching tag and/or capability filters. Local only.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `tag` | `string` | No | Filter by tag. |
| `capability` | `string` | No | Filter by exposed capability (from bot config `expose` array). |
| `limit` | `number` | No | Maximum number of results to return. |

**Returns:** One line per matching bot with name, state, and tags.

```
alice: running [backend, api]
charlie: running [frontend]
```

### `mecha_list_sessions`

Lists sessions for a local bot, returning metadata (ID, title, timestamps).

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `target` | `string` | Yes | bot name. |
| `limit` | `number` | No | Maximum number of sessions to return. |

**Returns:** JSON array of session metadata objects.

### `mecha_get_session`

Returns full detail for a specific session, including message content.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `target` | `string` | Yes | bot name. |
| `sessionId` | `string` | Yes | Session ID. |

**Returns:** JSON object with session metadata and messages. Returns an error if the session is not found.

### `mecha_workspace_list`

Lists files in a local bot's workspace directory. Delegates to the bot runtime's embedded MCP tool.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `target` | `string` | Yes | bot name. |
| `path` | `string` | No | Subdirectory path relative to workspace root. Defaults to root. |

**Returns:** File listing from the bot's workspace.

### `mecha_workspace_read`

Reads a file from a local bot's workspace. Delegates to the bot runtime's embedded MCP tool.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `target` | `string` | Yes | bot name. |
| `path` | `string` | Yes | File path relative to workspace root. |

**Returns:** File contents as text.

### `mecha_query`

Send a message to a bot and receive a response. Supports both local and remote bots.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `target` | `string` | Yes | Bot name (`bot-a`) or remote address (`bot-a@spark01`). |
| `message` | `string` | Yes | Message to send (must be non-empty). |
| `sessionId` | `string` | No | Session ID to continue an existing conversation. |

**Returns:** Bot's text response. If a session was created or continued, includes `[sessionId: ...]` for continuity. Remote queries include `X-Mecha-Source: mcp:<client-name>` for ACL enforcement.

## Audit Log

Every MCP tool call is logged to `~/.mecha/audit.jsonl` with:

- Timestamp, client info, tool name, parameters
- Result status (ok/error) and duration
- Client identification (e.g., `claude-desktop/1.2.3`)

View and manage the audit log:

```bash
mecha audit log              # Show recent entries
mecha audit log --limit 10   # Show last 10 entries
mecha audit log --json       # JSON output
mecha audit clear            # Clear the audit log
```

### Audit Entry Format

Each line in `audit.jsonl` is a JSON object with the following fields:

| Field | Type | Description |
|-------|------|-------------|
| `ts` | `string` | ISO 8601 timestamp. |
| `client` | `string` | Client identifier in `name/version` format (e.g., `claude-desktop/1.2.3`), or `unknown`. |
| `tool` | `string` | Tool name (e.g., `mecha_list_bots`). |
| `params` | `object` | Tool parameters. Truncated to 1024 bytes if larger. |
| `result` | `string` | One of `ok`, `error`, or `rate-limited`. |
| `error` | `string` | Error message, present only when `result` is `error`. |
| `durationMs` | `number` | Execution time in milliseconds. |

## Rate Limiting

Built-in sliding-window rate limiting protects against runaway clients:

| Tool Tier | Limit |
|-----------|-------|
| Read tools (discovery, sessions, workspace) | 120 requests/minute |
| Query tools (`mecha_query`) | 30 requests/minute |

Rate limits are per-tool and reset on a sliding window.

## Tool Annotations

All tools include [MCP tool annotations](https://spec.modelcontextprotocol.io/specification/2025-03-26/server/tools/#annotations) so clients can display appropriate UI:

- **Read-only tools**: marked `readOnlyHint: true`, `destructiveHint: false`
- **Query tool**: marked `readOnlyHint: false` (sends messages to bots)

## Transports

### Stdio Transport

The default transport for local MCP clients (Claude Desktop, Cursor, Claude Code). The server communicates over stdin/stdout using JSON-RPC.

```bash
mecha mcp serve                    # stdio (default)
mecha mcp serve --transport stdio  # explicit
```

### HTTP Transport

For remote MCP clients and web-based tools, the MCP server supports HTTP transport using the Streamable HTTP protocol (MCP 2025-03-26):

```bash
mecha mcp serve --transport http
mecha mcp serve --transport http --port 8080 --host 0.0.0.0
```

| Option | Default | Description |
|--------|---------|-------------|
| `--transport` | `stdio` | Transport: `stdio` or `http` |
| `--port` | `7680` | HTTP port |
| `--host` | `127.0.0.1` | Bind address |
| `--token` | — | Bearer token for HTTP authentication (required for non-loopback hosts) |

The HTTP transport exposes a single `/mcp` endpoint that handles:

- **POST** — Send JSON-RPC messages (creates a new session if no `mcp-session-id` header)
- **GET** — Open an SSE stream for server-initiated messages (requires `mcp-session-id`)
- **DELETE** — Close a session (requires `mcp-session-id`)

Each HTTP session gets its own transport and server instance. Sessions are tracked by the `mcp-session-id` header returned in the response to the initial `initialize` request.

#### Session Management

| Property | Value |
|----------|-------|
| Max concurrent sessions | 64 |
| Session idle timeout | 30 minutes |
| Session ID format | UUID v4 |

Idle sessions are automatically expired and cleaned up. When a session is closed (via DELETE or timeout), both the transport and server instances are shut down. On process shutdown (SIGINT/SIGTERM), all sessions are closed gracefully before the HTTP server stops.

> **Security note:** When binding to a non-loopback address (e.g., `0.0.0.0`), you must provide a `--token` for Bearer authentication. All requests must include an `Authorization: Bearer <token>` header. On localhost (`127.0.0.1`), authentication is optional but recommended. Token comparison uses constant-time `safeCompare` to prevent timing attacks.

```bash
# Example: Start HTTP server with authentication
mecha mcp serve --transport http --token my-secret-token
mecha mcp serve --transport http --host 0.0.0.0 --token my-secret-token
```

## Architecture

```
┌─────────────────┐     stdio      ┌─────────────────┐
│  Claude Desktop │ ◄────────────► │  mecha mcp serve│
│  Cursor         │                │  (MCP Server)   │
│  Claude Code    │                └────────┬────────┘
└─────────────────┘                         │
                                   ┌────────┴────────┐
┌─────────────────┐     HTTP       │  ProcessManager │
│  Remote clients │ ◄────────────► │  NodeRegistry   │
│  Web tools      │   /mcp         │  AuditLog       │
└─────────────────┘                └─────────────────┘
```

The MCP server runs as a stdio process launched by the client, or as an HTTP server for remote access. It connects to the same local infrastructure as the CLI — ProcessManager for bot lifecycle, NodeRegistry for mesh nodes, and service functions for sessions and workspace access.

## API Reference

See [@mecha/mcp-server API Reference](/reference/api/mcp-server) for the complete API: `MeshMcpContext`, `createMeshMcpServer`, `createAuditLog`, `createRateLimiter`, server factory, and package exports.
