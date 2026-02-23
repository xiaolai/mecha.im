# Mesh Networking & MCP Server

## Overview

The mesh system allows mechas running on different machines to be discovered and managed as a single fleet. It consists of three layers:

1. **Agent server** — runs on each machine, exposes local mechas to the network
2. **Node registry** — tracks known peers in `~/.mecha/nodes.json`
3. **Mesh MCP server** — aggregates all mechas into a single MCP endpoint

## Agent Server

**Package**: `@mecha/agent` (`packages/agent/`)

Each machine in the mesh runs an agent server (default port 7660) that provides HTTP access to its local mechas.

### Starting the Agent

```bash
mecha agent start              # default port 7660
mecha agent start --port 8080  # custom port
mecha agent key                # show or regenerate API key
```

### Agent Routes

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/healthz` | Health check (uptime, node health status) |
| GET | `/mechas` | List all local mechas |
| POST | `/mechas` | Create a mecha (from remote node) |
| DELETE | `/mechas/:id` | Remove a mecha |
| POST | `/mechas/:id/start` | Start a mecha |
| POST | `/mechas/:id/stop` | Stop a mecha |
| GET | `/sessions/:id` | List sessions for a mecha |
| POST | `/sessions/:id` | Create session |
| GET | `/sessions/:id/:sessionId` | Get session details |
| POST | `/sessions/:id/:sessionId/message` | Send message (SSE) |
| GET | `/events` | SSE stream of container events |

### Authentication

All agent routes require a bearer token in the `Authorization` header. The API key is stored locally and shared when registering nodes.

## Node Registry

**Source**: `packages/agent/src/node-registry.ts`

Nodes are stored in `~/.mecha/nodes.json`:

```json
[
  {
    "name": "workstation",
    "host": "100.64.0.2",
    "apiKey": "mecha_...",
    "addedAt": "2026-02-20T10:00:00Z"
  }
]
```

### CLI Operations

```bash
mecha node add workstation 100.64.0.2 --key mecha_abc123
mecha node rm workstation
mecha node ls
mecha node check workstation
```

### Functions

| Function | Description |
|----------|-------------|
| `readNodes()` | Read nodes from disk (sync) |
| `readNodesAsync()` | Read nodes from disk (async) |
| `writeNodes(entries)` | Persist nodes to disk |
| `addNode(name, host, key)` | Register a remote node |
| `removeNode(name)` | Unregister a node |

## Discovery

**Source**: `packages/agent/src/discovery.ts`

| Function | Description |
|----------|-------------|
| `discoverTailscalePeers()` | Query Tailscale for peer machines |
| `probeMechaAgent(host, port, apiKey)` | Test if a host has a running mecha agent |
| `discoverMechaNodes()` | Auto-discover mesh nodes on Tailscale network |

## Heartbeat

**Source**: `packages/agent/src/heartbeat.ts`

| Function | Description |
|----------|-------------|
| `startHeartbeat(opts)` | Periodically ping all registered nodes |

Returns health status per node: online/offline, latency in ms.

## Mecha Locator

**Source**: `packages/service/src/locator.ts`

The `MechaLocator` resolves a Mecha ID to its location (local or remote node). Used by CLI (`--node` flag), dashboard API routes, and the MCP server.

```typescript
const locator = new MechaLocator();
const ref = await locator.locate(docker, "mx-my-mecha-abc123", nodes);
// ref = { node: "local", entry: undefined }
// or    { node: "workstation", entry: { name, host, apiKey } }
```

Resolution order:
1. Check local Docker containers
2. Query each registered node via `agentFetch(node, "/mechas")`
3. Cache result for subsequent lookups
4. `invalidate(mechaId)` on error to force re-resolution

## Mesh MCP Server

**Package**: `@mecha/mcp-server` (`packages/mcp-server/`)

A host-level MCP server that exposes all mechas across all mesh nodes through a single endpoint.

### Starting

```bash
mecha mcp serve              # stdio mode (for Claude Desktop / Claude Code)
mecha mcp serve --http       # HTTP mode on port 7670
mecha mcp config             # print ready-to-paste config JSON
```

### Claude Desktop / Claude Code Config

```json
{
  "mcpServers": {
    "mecha-mesh": {
      "type": "stdio",
      "command": "mecha",
      "args": ["mcp", "serve"]
    }
  }
}
```

### Tools (12 total)

#### Discovery

| Tool | Description |
|------|-------------|
| `mesh_list_nodes` | List all registered nodes with health status and latency |
| `mesh_list_mechas` | List mechas across all nodes (optional `node` filter) |
| `mesh_mecha_status` | Get detailed status for a specific mecha |

#### Sessions

| Tool | Description |
|------|-------------|
| `mesh_list_sessions` | List sessions for a mecha |
| `mesh_get_session` | Get session details (optionally include messages) |
| `mesh_create_session` | Create a new session |

#### Query

| Tool | Description |
|------|-------------|
| `mesh_query` | Send a message to a mecha and get the response. Auto-creates session if needed. |

#### Management

| Tool | Description |
|------|-------------|
| `mesh_delete_session` | Delete a session |
| `mesh_star_session` | Star or unstar a session |
| `mesh_rename_session` | Rename a session |

#### Workspace

| Tool | Description |
|------|-------------|
| `mesh_workspace_list` | List files in a mecha's workspace (optional subdirectory) |
| `mesh_workspace_read` | Read a file from a mecha's workspace |

### Architecture

```
MCP Client (Claude Desktop, etc.)
     │
     ▼
  MeshMcpServer
  ├── ToolContext { docker, getNodes, locator }
  ├── registerNodeTools()     → mesh_list_nodes
  ├── registerMechaTools()    → mesh_list_mechas, mesh_mecha_status
  ├── registerSessionTools()  → mesh_list_sessions, mesh_get_session
  ├── registerQueryTools()    → mesh_create_session, mesh_query
  ├── registerManageTools()   → mesh_delete/star/rename_session
  └── registerWorkspaceTools()→ mesh_workspace_list/read
```

Each tool uses `MechaLocator` to determine if the target mecha is local or remote, then dispatches accordingly:
- **Local**: Calls service functions directly (e.g., `mechaLs()`, `runtimeFetch()`)
- **Remote**: Uses `agentFetch()` to proxy to the remote agent server

### Error Handling

The `toolError()` helper maps domain errors to MCP error content blocks:
- `MechaNotLocatedError` → invalidates locator cache + returns user-friendly message
- `NodeUnreachableError` → returns connectivity error with node details
- `SessionNotFoundError` → invalidates cache + returns not-found message
- Generic errors → `toUserMessage()` from `@mecha/contracts`

### Transport

| Mode | Transport | Use Case |
|------|-----------|----------|
| stdio | `StdioServerTransport` | Claude Desktop, Claude Code, Cursor |
| HTTP | `StreamableHTTPServerTransport` (Fastify) | Web clients, testing |

HTTP mode includes session management with 30-minute TTL cleanup.
