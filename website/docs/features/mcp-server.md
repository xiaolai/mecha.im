# MCP Server

Mecha exposes its control plane as an [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) server, allowing any MCP-compatible client — Claude Desktop, Cursor, Claude Code — to discover, inspect, and query your CASAs.

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
| `mecha_list_casas` | List CASAs (local or from a remote node) |
| `mecha_casa_status` | Get detailed status for a specific CASA |
| `mecha_discover` | Find CASAs by tag or capability |

### Sessions

| Tool | Description |
|------|-------------|
| `mecha_list_sessions` | List sessions for a local CASA |
| `mecha_get_session` | Get session detail with optional message content |

### Workspace

| Tool | Description |
|------|-------------|
| `mecha_workspace_list` | List files in a CASA's workspace |
| `mecha_workspace_read` | Read a file from a CASA's workspace |

### Query (query mode only)

| Tool | Description |
|------|-------------|
| `mecha_query` | Send a message to a CASA (wave 2 — currently stubbed) |

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
- **Query tool**: marked `readOnlyHint: false` (sends messages to CASAs)

## HTTP Transport

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

Each HTTP session gets its own transport and server instance. Sessions are tracked by the `mcp-session-id` header returned in the response to the initial `initialize` request. A maximum of 64 concurrent sessions is enforced.

> **Security note:** When binding to a non-loopback address (e.g., `0.0.0.0`), you must provide a `--token` for Bearer authentication. All requests must include an `Authorization: Bearer <token>` header. On localhost (`127.0.0.1`), authentication is optional but recommended.

```bash
# Example: Initialize a session (with token)
curl -X POST http://localhost:7680/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer my-secret-token" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
```

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

The MCP server runs as a stdio process launched by the client, or as an HTTP server for remote access. It connects to the same local infrastructure as the CLI — ProcessManager for CASA lifecycle, NodeRegistry for mesh nodes, and service functions for sessions and workspace access.
