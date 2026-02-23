# Mesh MCP Server — Implementation Spec

> A host-level MCP server that exposes all mechas across all nodes in a
> headscale mesh as MCP tools. Any MCP client (Claude Desktop, Claude Code,
> Cursor, or custom) can discover, query, and manage any CASA on any node
> through a single MCP endpoint.

## Status: Draft

## Context

### What exists today

Two MCP surfaces already exist:

1. **Per-container MCP** (`packages/runtime/src/mcp/server.ts`) — Each CASA
   container exposes `/mcp` with tools for its own workspace and sessions.
   Single-tenant: one LLM ↔ one CASA.

2. **Agent server** (`packages/agent/`) — Fastify HTTP server (port 7660) with
   bearer auth, session routes, node registry, heartbeat. Provides the
   inter-node plumbing built in Phases 0–4 of `mesh-metadata-spec.md`.

### What's missing

A **mesh-level MCP server** that:
- Runs on the host (not inside any container)
- Sees all nodes and all mechas across the headscale network
- Routes operations to the correct node via `MechaLocator` + `agentFetch`
- Exposes a single MCP endpoint that any client can connect to

### Architecture

```
Claude Desktop / Claude Code / Cursor / Custom MCP Client
  │
  │  stdio or Streamable HTTP
  ▼
┌─────────────────────────────────────────────┐
│ Mesh MCP Server (packages/mcp-server)       │
│                                             │
│  MechaLocator → agentFetch → remoteSession* │
│  readNodes() → heartbeat health             │
│  DockerClient → local mechas                │
└────────┬────────────────────┬───────────────┘
         │ local              │ remote (headscale)
         ▼                    ▼
   Local Docker          Agent Server (node-b:7660)
   ├── mx-project-a      ├── mx-gpu-model-x
   └── mx-project-b      └── mx-gpu-model-y
```

## Terminology

| Term | Definition |
|---|---|
| **Mesh MCP** | The new MCP server described in this spec |
| **Per-container MCP** | The existing MCP at `container:port/mcp` |
| **Agent** | The Fastify server at `node:7660` (inter-node API) |
| **Runtime** | The Fastify server inside a CASA container (intra-container API) |

---

## Phase 0 — Package Scaffold

### 0.1 — New package: `packages/mcp-server`

**Files:**

```
packages/mcp-server/
  package.json
  tsconfig.json
  vitest.config.ts
  src/
    index.ts           — public exports
    server.ts          — MCP server factory
    transport.ts       — stdio + HTTP transport setup
    tools/
      index.ts         — tool registration barrel
      nodes.ts         — mesh_list_nodes
      mechas.ts        — mesh_list_mechas, mesh_mecha_status
      sessions.ts      — mesh_list_sessions, mesh_get_session
      query.ts         — mesh_query, mesh_create_session
      manage.ts        — mesh_delete_session, mesh_star_session, mesh_rename_session
      workspace.ts     — mesh_workspace_list, mesh_workspace_read
  __tests__/
    server.test.ts
    tools/
      nodes.test.ts
      mechas.test.ts
      sessions.test.ts
      query.test.ts
      manage.test.ts
      workspace.test.ts
```

**`package.json`:**

```json
{
  "name": "@mecha/mcp-server",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:coverage": "vitest run --coverage"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.26.0",
    "@mecha/core": "workspace:*",
    "@mecha/contracts": "workspace:*",
    "@mecha/docker": "workspace:*",
    "@mecha/service": "workspace:*",
    "@mecha/agent": "workspace:*",
    "zod": "^3.24.4"
  },
  "devDependencies": {
    "@vitest/coverage-v8": "^3.2.1",
    "vitest": "^3.2.1",
    "typescript": "^5.8.3"
  }
}
```

**Dependencies rationale:**
- `@mecha/service` — `MechaLocator`, `remoteSession*`, `mechaLs`, `agentFetch`, `resolveMcpEndpoint`
- `@mecha/agent` — `readNodes()`, `NodeEntry` type
- `@mecha/docker` — `createDockerClient()` for local operations
- `@mecha/core` — `MechaRef`, `ParsedSession`, `SessionSummary` types
- `@mecha/contracts` — Error types, Zod schemas
- `@modelcontextprotocol/sdk` — MCP server + transports

**`vitest.config.ts`:** Same pattern as other packages (100% coverage thresholds).

**Tests:** `packages/mcp-server/__tests__/`

| # | Test | Assertion |
|---|---|---|
| 1 | `createMeshMcpServer()` returns McpServerHandle | server has name `"mecha-mesh"` |
| 2 | All tools are registered | tool count matches expected |
| 3 | Server can be connected via mock transport | no errors on connect |

---

## Phase 1 — Core Server Factory

### 1.1 — `createMeshMcpServer()` (packages/mcp-server)

**File:** `packages/mcp-server/src/server.ts`

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DockerClient } from "@mecha/docker";
import { MechaLocator } from "@mecha/service";
import type { NodeEntry } from "@mecha/agent";
import { registerAllTools } from "./tools/index.js";

export interface MeshMcpOptions {
  docker: DockerClient;
  /** Provider of current node list. Called on each tool invocation. */
  getNodes: () => NodeEntry[];
  /** Shared locator instance (optional, created if omitted). */
  locator?: MechaLocator;
}

export interface MeshMcpHandle {
  mcpServer: McpServer;
  locator: MechaLocator;
}

export function createMeshMcpServer(opts: MeshMcpOptions): MeshMcpHandle {
  const locator = opts.locator ?? new MechaLocator();
  const mcpServer = new McpServer(
    { name: "mecha-mesh", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  registerAllTools(mcpServer, {
    docker: opts.docker,
    getNodes: opts.getNodes,
    locator,
  });

  return { mcpServer, locator };
}
```

### 1.2 — Tool context (packages/mcp-server)

**File:** `packages/mcp-server/src/tools/index.ts`

All tools share a `ToolContext` — the injected dependencies for each tool handler.

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DockerClient } from "@mecha/docker";
import type { MechaLocator } from "@mecha/service";
import type { NodeEntry } from "@mecha/agent";

export interface ToolContext {
  docker: DockerClient;
  getNodes: () => NodeEntry[];
  locator: MechaLocator;
}

export function registerAllTools(mcpServer: McpServer, ctx: ToolContext): void {
  registerNodeTools(mcpServer, ctx);
  registerMechaTools(mcpServer, ctx);
  registerSessionTools(mcpServer, ctx);
  registerQueryTools(mcpServer, ctx);
  registerManageTools(mcpServer, ctx);
  registerWorkspaceTools(mcpServer, ctx);
}
```

---

## Phase 2 — Discovery Tools

### 2.1 — `mesh_list_nodes`

**File:** `packages/mcp-server/src/tools/nodes.ts`

```
Tool:    mesh_list_nodes
Params:  (none)
Returns: JSON array of { name, host, status, latencyMs, mechaCount }
```

Implementation:
1. Call `getNodes()` for the node registry
2. For each node, call `agentFetch(node, "/healthz")` with 3s timeout
3. Return health array (same shape as `NodeHealth` from heartbeat)

**Why not reuse heartbeat?** The heartbeat runs on a 15s interval inside the
agent server. The MCP server may or may not have an agent running. It performs
its own lightweight health check on demand.

**Tests:** `packages/mcp-server/__tests__/tools/nodes.test.ts`

| # | Test | Assertion |
|---|---|---|
| 1 | No nodes → returns empty array | `[]` |
| 2 | One online node → returns status "online" with latency | latencyMs > 0 |
| 3 | Unreachable node → returns status "offline" | latencyMs null |
| 4 | Multiple nodes → all checked in parallel | result.length === nodes.length |

### 2.2 — `mesh_list_mechas`

**File:** `packages/mcp-server/src/tools/mechas.ts`

```
Tool:    mesh_list_mechas
Params:  { node?: string }  — optional filter by node name
Returns: JSON array of { node, id, name, state, path, port? }
```

Implementation:
1. List local mechas via `mechaLs(docker)`
2. For each remote node, `agentFetch(node, "/mechas")` (skip on error)
3. Merge results, tag each with `node: "local"` or `node: entry.name`
4. If `node` param provided, filter to that node only

```
Tool:    mesh_mecha_status
Params:  { mecha_id: string }
Returns: JSON { node, id, name, state, path, port, sessionCount }
```

Implementation:
1. `locator.locate(docker, mechaId, getNodes())`
2. If local → `mechaStatus(docker, mechaId)`
3. If remote → `agentFetch(node, "/mechas/${mid}")`

**Tests:** `packages/mcp-server/__tests__/tools/mechas.test.ts`

| # | Test | Assertion |
|---|---|---|
| 1 | Local mecha listed | node = "local", has id and state |
| 2 | Remote mecha listed | node = remote name |
| 3 | `--node` filter works | only matching node returned |
| 4 | Unreachable remote skipped | local results still returned |
| 5 | `mesh_mecha_status` local | returns status with session count |
| 6 | `mesh_mecha_status` remote | proxied via agentFetch |
| 7 | `mesh_mecha_status` not found | MechaNotLocatedError → error content |

---

## Phase 3 — Session Read Tools

### 3.1 — `mesh_list_sessions`

**File:** `packages/mcp-server/src/tools/sessions.ts`

```
Tool:    mesh_list_sessions
Params:  { mecha_id: string }
Returns: JSON { sessions: SessionSummary[], meta: Record<string, SessionMeta> }
```

Implementation:
1. `locator.locate(docker, mechaId, getNodes())`
2. `remoteSessionList(docker, mechaId, target)`
3. Return result (works when container is stopped — filesystem reads)

### 3.2 — `mesh_get_session`

```
Tool:    mesh_get_session
Params:  { mecha_id: string, session_id: string, include_messages?: boolean }
Returns: JSON ParsedSession (with or without messages array)
```

Implementation:
1. `locator.locate(docker, mechaId, getNodes())`
2. `remoteSessionGet(docker, mechaId, sessionId, target)`
3. If `include_messages` is false (default), strip `messages` array to reduce token usage

**Tests:** `packages/mcp-server/__tests__/tools/sessions.test.ts`

| # | Test | Assertion |
|---|---|---|
| 1 | List sessions local | calls remoteSessionList with local target |
| 2 | List sessions remote | calls remoteSessionList with remote target |
| 3 | Get session with messages | response has messages array |
| 4 | Get session without messages (default) | messages omitted |
| 5 | Session not found | SessionNotFoundError → error content |
| 6 | Mecha not found | MechaNotLocatedError → error content |

---

## Phase 4 — Query Tool (Send Message)

### 4.1 — `mesh_query`

**File:** `packages/mcp-server/src/tools/query.ts`

```
Tool:    mesh_query
Params:  {
  mecha_id: string,
  message: string,
  session_id?: string,   — resume existing session (omit to auto-create)
}
Returns: JSON { session_id: string, response: string }
```

This is the primary tool — it sends a message to a CASA and returns the response.

Implementation:
1. `locator.locate(docker, mechaId, getNodes())`
2. Determine endpoint:
   - Local: `runtimeFetch(docker, mechaId, "/api/sessions/{sid}/message", ...)`
   - Remote: `agentFetch(node, "/mechas/{mid}/sessions/{sid}/message", ...)`
3. If no `session_id`: create one first
   - Local: `mechaSessionCreate(docker, { id: mechaId })`
   - Remote: `agentFetch(node, "/mechas/{mid}/sessions", { method: "POST", ... })`
4. Collect the SSE stream into a complete response (buffer mode)
5. Return `{ session_id, response }`

**SSE collection:**

```typescript
async function collectSseResponse(res: Response): Promise<string> {
  const parts: string[] = [];
  const reader = res.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // Parse SSE events from buffer
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const json = line.slice(6);
      if (json === "[DONE]") continue;
      try {
        const event = JSON.parse(json);
        if (event.type === "assistant" && event.message?.content) {
          for (const block of event.message.content) {
            if (block.type === "text") parts.push(block.text);
          }
        }
      } catch { /* skip malformed lines */ }
    }
  }
  return parts.join("");
}
```

**Important:** `agentFetch` default timeout is 10s — too short for LLM responses.
Use `timeoutMs: 0` (no timeout) for message endpoints. Client disconnect is
handled by the MCP transport closing the connection.

### 4.2 — `mesh_create_session`

```
Tool:    mesh_create_session
Params:  { mecha_id: string, title?: string }
Returns: JSON { session_id: string, mecha_id: string, node: string }
```

Implementation:
1. Locate mecha
2. Local: `mechaSessionCreate(docker, { id: mechaId, title })`
3. Remote: `agentFetch(node, POST /mechas/{mid}/sessions)`
4. Return session ID

**Tests:** `packages/mcp-server/__tests__/tools/query.test.ts`

| # | Test | Assertion |
|---|---|---|
| 1 | Query with existing session_id | uses that session, returns response text |
| 2 | Query without session_id | creates session first, returns both session_id and response |
| 3 | Query remote mecha | dispatches via agentFetch |
| 4 | Mecha not running | error: container not running |
| 5 | Mecha not found | MechaNotLocatedError |
| 6 | SSE stream collected correctly | response contains all text blocks |
| 7 | Create session local | returns session ID |
| 8 | Create session remote | proxied via agent |

---

## Phase 5 — Management Tools

### 5.1 — `mesh_delete_session`, `mesh_star_session`, `mesh_rename_session`

**File:** `packages/mcp-server/src/tools/manage.ts`

```
Tool:    mesh_delete_session
Params:  { mecha_id: string, session_id: string }
Returns: { deleted: true }

Tool:    mesh_star_session
Params:  { mecha_id: string, session_id: string, starred: boolean }
Returns: { ok: true }

Tool:    mesh_rename_session
Params:  { mecha_id: string, session_id: string, title: string }
Returns: { ok: true }
```

Implementation: All follow the same pattern:
1. `locator.locate(docker, mechaId, getNodes())`
2. Call the appropriate `remoteSession*` function

**Tests:** `packages/mcp-server/__tests__/tools/manage.test.ts`

| # | Test | Assertion |
|---|---|---|
| 1 | Delete local session | calls remoteSessionDelete with local target |
| 2 | Delete remote session | proxied via agent |
| 3 | Delete nonexistent | SessionNotFoundError → error content |
| 4 | Star local session | calls remoteSessionMetaUpdate |
| 5 | Star remote session | PATCHes agent |
| 6 | Rename local session | calls remoteSessionMetaUpdate |
| 7 | Rename remote session | PATCHes agent |
| 8 | Rename with empty title | validation error |

---

## Phase 6 — Workspace Tools

### 6.1 — `mesh_workspace_list`, `mesh_workspace_read`

**File:** `packages/mcp-server/src/tools/workspace.ts`

```
Tool:    mesh_workspace_list
Params:  { mecha_id: string, path?: string }
Returns: JSON array of { name, type: "file"|"directory" }

Tool:    mesh_workspace_read
Params:  { mecha_id: string, path: string }
Returns: File contents as text
```

Implementation:
1. Locate mecha
2. Resolve the per-container MCP endpoint:
   - Local: `resolveMcpEndpoint(docker, mechaId)` → `http://127.0.0.1:{port}/mcp`
   - Remote: `agentFetch(node, "/mechas/{mid}/mcp-endpoint")` (new agent route,
     or derive from `agentFetch(node, "/mechas/{mid}")` response)
3. Forward as an MCP tool call to the per-container MCP:
   - Call `mecha_workspace_list` / `mecha_workspace_read` on the container's MCP

**Alternative (simpler):** For local mechas, read the bind-mounted project
directory directly from the host filesystem. For remote mechas, proxy via the
agent's session message route with a workspace-reading prompt.

**Recommended approach:** Use the existing per-container MCP tools. This avoids
reimplementing path traversal protection and works identically for local and
remote.

**New agent route needed:**

```
GET /mechas/:id/mcp-endpoint → { endpoint: string, token?: string }
```

Returns the container's MCP endpoint URL and auth token. The mesh MCP server
can then call MCP-over-HTTP on that endpoint.

**Tests:** `packages/mcp-server/__tests__/tools/workspace.test.ts`

| # | Test | Assertion |
|---|---|---|
| 1 | List workspace root local | returns file entries |
| 2 | List workspace subdirectory | returns entries for subdir |
| 3 | Read file local | returns file contents |
| 4 | Read file remote | proxied via agent + container MCP |
| 5 | Path traversal attempt | error: denied |
| 6 | Container not running | error content |

---

## Phase 7 — Transport Layer

### 7.1 — stdio transport

**File:** `packages/mcp-server/src/transport.ts`

```typescript
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

export async function runStdio(handle: MeshMcpHandle): Promise<void> {
  const transport = new StdioServerTransport();
  await handle.mcpServer.connect(transport);
  // Blocks until stdin closes
}
```

This is the primary transport for Claude Desktop and Claude Code. The MCP
server runs as a subprocess, communicating via stdin/stdout.

### 7.2 — Streamable HTTP transport

```typescript
export async function runHttp(
  handle: MeshMcpHandle,
  opts: { port?: number; host?: string },
): Promise<void> {
  // Same pattern as runtime/src/mcp/server.ts registerMcpRoutes
  // Fastify server with POST/GET/DELETE /mcp routes
  // Session management with TTL cleanup
}
```

HTTP transport allows remote MCP clients to connect. Uses the same
`StreamableHTTPServerTransport` pattern already proven in the runtime package.

### 7.3 — Entrypoint binary

**File:** `packages/mcp-server/src/main.ts`

```typescript
#!/usr/bin/env node
import { createDockerClient } from "@mecha/docker";
import { readNodes } from "@mecha/agent";
import { createMeshMcpServer } from "./server.js";
import { runStdio, runHttp } from "./transport.js";

const mode = process.argv[2] ?? "stdio";
const docker = createDockerClient();
const handle = createMeshMcpServer({
  docker,
  getNodes: () => readNodes(),
});

if (mode === "http") {
  const port = Number(process.env.MCP_PORT ?? "7670");
  await runHttp(handle, { port });
} else {
  await runStdio(handle);
}
```

**`package.json` bin field:**

```json
{
  "bin": {
    "mecha-mcp": "dist/main.js"
  }
}
```

---

## Phase 8 — CLI Integration

### 8.1 — `mecha mcp serve` command

**Modify:** `packages/cli/src/commands/mcp.ts`

Add a `serve` subcommand that starts the mesh MCP server:

```
mecha mcp serve [--http] [--port <port>]
```

- Default: stdio mode (for Claude Desktop config)
- `--http`: Start HTTP transport on port 7670 (or `--port`)
- Outputs ready-to-paste config for Claude Desktop / Claude Code

```typescript
mcp.command("serve")
  .description("Start the mesh MCP server")
  .option("--http", "Use HTTP transport instead of stdio")
  .option("--port <port>", "HTTP port (default: 7670)", "7670")
  .action(async (opts) => {
    const handle = createMeshMcpServer({
      docker: deps.dockerClient,
      getNodes: () => readNodes(),
    });
    if (opts.http) {
      await runHttp(handle, { port: Number(opts.port) });
    } else {
      await runStdio(handle);
    }
  });
```

### 8.2 — `mecha mcp config` output update

The existing `mecha mcp <id>` shows per-container MCP config. Add mesh config:

```
mecha mcp --mesh [--config]
```

Outputs:
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

**Tests:** `packages/cli/__tests__/commands/mcp.test.ts`

| # | Test | Assertion |
|---|---|---|
| 1 | `mcp serve` starts stdio mode | no error, server created |
| 2 | `mcp serve --http` starts HTTP | listens on port |
| 3 | `mcp --mesh --config` outputs mesh config | JSON has mecha-mesh entry |
| 4 | `mcp <id>` still works (backward compat) | per-container endpoint |

---

## Phase 9 — Error Handling & Edge Cases

### 9.1 — Error mapping

MCP tool handlers must never throw — they return error content blocks.

```typescript
function toolError(err: unknown): { content: [{ type: "text"; text: string }]; isError: true } {
  const msg = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text" as const, text: `Error: ${msg}` }], isError: true };
}
```

Error mapping:

| Domain Error | MCP Tool Response |
|---|---|
| `MechaNotLocatedError` | `"Error: Mecha mx-foo not found on any node"` |
| `NodeUnreachableError` | `"Error: Node gpu-server unreachable"` |
| `NodeAuthFailedError` | `"Error: Authentication failed for node gpu-server"` |
| `SessionNotFoundError` | `"Error: Session abc-123 not found"` |
| `NoPortBindingError` | `"Error: Mecha mx-foo has no port binding (not running?)"` |
| `SessionBusyError` | `"Error: Session is busy processing another message"` |

### 9.2 — Locator cache invalidation

When a tool returns `SessionNotFoundError` or `MechaNotLocatedError`:
- Call `locator.invalidate(mechaId)` so the next call re-queries
- This handles container migrations between nodes

### 9.3 — Streaming timeout

`mesh_query` has no fixed timeout (LLM responses can take minutes).
The MCP transport handles client disconnect — if the MCP client disconnects,
the transport closes, the `agentFetch` signal is aborted, and the upstream
SSE stream is cancelled.

For HTTP transport, use `req.signal` propagation:

```typescript
// In mesh_query tool handler
const abortController = new AbortController();
// MCP SDK provides a signal via the tool context (if available)
// Otherwise, rely on transport-level disconnect
```

---

## Tool Inventory

| Tool | Params | Needs Running? | Reads From |
|---|---|---|---|
| `mesh_list_nodes` | — | No | Node registry + healthz |
| `mesh_list_mechas` | `node?` | No | Docker + agent `/mechas` |
| `mesh_mecha_status` | `mecha_id` | No | Docker/agent inspect |
| `mesh_list_sessions` | `mecha_id` | No | JSONL filesystem |
| `mesh_get_session` | `mecha_id, session_id, include_messages?` | No | JSONL filesystem |
| `mesh_create_session` | `mecha_id, title?` | Yes | Runtime API |
| `mesh_query` | `mecha_id, message, session_id?` | Yes | Runtime API (SSE) |
| `mesh_delete_session` | `mecha_id, session_id` | No | Filesystem + best-effort runtime |
| `mesh_star_session` | `mecha_id, session_id, starred` | No | session-meta.json |
| `mesh_rename_session` | `mecha_id, session_id, title` | No | session-meta.json |
| `mesh_workspace_list` | `mecha_id, path?` | Yes | Container MCP |
| `mesh_workspace_read` | `mecha_id, path` | Yes | Container MCP |

---

## Dependency Graph

```
Phase 0 (scaffold, package.json, tsconfig)
  └→ Phase 1 (server factory, ToolContext)
       ├→ Phase 2 (discovery tools: nodes, mechas)
       ├→ Phase 3 (session read tools)
       ├→ Phase 4 (query tool — most complex)
       ├→ Phase 5 (management tools)
       └→ Phase 6 (workspace tools — needs agent MCP-endpoint route)
Phase 7 (transport: stdio + HTTP)
  └→ Phase 8 (CLI integration)
Phase 9 (error handling — applied across all phases)
```

Phases 2–6 are independent of each other and can be built in parallel.
Phase 7 depends on Phase 1. Phase 8 depends on Phase 7.

## File Inventory

| Phase | New Files | Modified Files |
|---|---|---|
| 0 | `mcp-server/package.json`, `mcp-server/tsconfig.json`, `mcp-server/vitest.config.ts` | `pnpm-workspace.yaml` |
| 1 | `mcp-server/src/server.ts`, `mcp-server/src/tools/index.ts` | — |
| 2 | `mcp-server/src/tools/nodes.ts`, `mcp-server/src/tools/mechas.ts`, `mcp-server/__tests__/tools/nodes.test.ts`, `mcp-server/__tests__/tools/mechas.test.ts` | — |
| 3 | `mcp-server/src/tools/sessions.ts`, `mcp-server/__tests__/tools/sessions.test.ts` | — |
| 4 | `mcp-server/src/tools/query.ts`, `mcp-server/__tests__/tools/query.test.ts` | — |
| 5 | `mcp-server/src/tools/manage.ts`, `mcp-server/__tests__/tools/manage.test.ts` | — |
| 6 | `mcp-server/src/tools/workspace.ts`, `mcp-server/__tests__/tools/workspace.test.ts` | `agent/src/routes/mechas.ts` (new MCP-endpoint route) |
| 7 | `mcp-server/src/transport.ts`, `mcp-server/src/main.ts` | — |
| 8 | — | `cli/src/commands/mcp.ts`, `cli/__tests__/commands/mcp.test.ts` |

## Quality Gates

Every phase must pass before proceeding:

```
pnpm test                # all tests pass
pnpm test:coverage       # 100% coverage gates
pnpm typecheck           # zero type errors
pnpm build               # clean build
```

## TDD Protocol

For each work item:

1. **Write the test file first** — all tests fail (red)
2. **Write minimum implementation** — tests pass (green)
3. **Refactor** — clean up while tests stay green
4. **Verify gates** — run all four quality checks
5. **Commit** — one commit per work item

No implementation code is written before its test exists.

---

## Future Enhancements (Out of Scope)

### MCP Resources

Expose mechas and sessions as MCP resources (read-only browsable):

```
resource://mecha-mesh/nodes                    — list of nodes
resource://mecha-mesh/mechas                   — list of all mechas
resource://mecha-mesh/mechas/{id}/sessions     — sessions for a mecha
resource://mecha-mesh/mechas/{id}/sessions/{sid}/transcript  — full transcript
```

This lets MCP clients browse the mesh without tool calls.

### Progress Notifications for Streaming

Instead of buffering the full response in `mesh_query`, emit MCP progress
notifications as chunks arrive:

```typescript
server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
  // Send progress as tokens stream in
  for await (const chunk of sseStream) {
    await extra.sendNotification({
      method: "notifications/progress",
      params: { progressToken, progress: chunkIndex, total: -1 },
    });
  }
});
```

Requires MCP SDK support for progress tokens in tool handlers.

### Lifecycle Tools

```
mesh_mecha_start    { mecha_id }
mesh_mecha_stop     { mecha_id }
mesh_mecha_restart  { mecha_id }
```

These turn the MCP server into a full orchestrator. Only for local mechas
initially (remote lifecycle management needs agent routes for start/stop).

### Multi-CASA Orchestration

A meta-tool that queries multiple CASAs in parallel:

```
mesh_multi_query { targets: [{ mecha_id, message }] }
```

Returns results from all CASAs. Useful for fan-out patterns (ask the same
question to different specialized agents).
