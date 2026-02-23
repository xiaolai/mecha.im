# Package Reference

## Overview

| Package | Type | Key Responsibility |
|---------|------|--------------------|
| `@mecha/cli` | CLI | User-facing command-line interface |
| `@mecha/dashboard` | Next.js App | Web UI — chat, terminal, overview |
| `@mecha/service` | Library | Business logic (lifecycle, sessions, chat) |
| `@mecha/docker` | Library | Docker daemon abstraction |
| `@mecha/runtime` | Server | Fastify server inside each Mecha container |
| `@mecha/agent` | Server | Mesh networking agent (node discovery, relay) |
| `@mecha/mcp-server` | MCP Server | Mesh MCP server (12 tools, stdio + HTTP) |
| `@mecha/channels` | Library | Channel adapters (Telegram), gateway routing |
| `@mecha/core` | Library | Types, ID generation, constants |
| `@mecha/contracts` | Library | Zod schemas, error types, error mapping |
| `@mecha/process` | Library | Process spawning, port allocation |

---

## @mecha/cli

**Path**: `packages/cli/`

Command-line interface built with Commander.js. Every command follows the `register*Command(program, deps)` pattern with `CommandDeps` dependency injection.

**Key exports**: `bin.ts` (entry point)

**Dependencies**: All workspace packages except runtime and dashboard.

**Test pattern**: Mock at Docker boundary, test observable output via formatter assertions.

---

## @mecha/dashboard

**Path**: `packages/dashboard/`

Next.js 15 App Router + React 19 web application. Shadcn/ui components, Tailwind CSS v4, @assistant-ui/react for chat.

**Key features**:
- Authentication via OAuth token
- Mecha list with real-time status (SSE events)
- Chat interface with session management
- xterm.js terminal
- Container inspection
- Node-aware API proxy for mesh operations

**Stack**: Next.js 15, React 19, Tailwind v4, shadcn/ui, lucide-react, @assistant-ui/react, xterm.js

---

## @mecha/service

**Path**: `packages/service/`

Core business logic layer shared by CLI and dashboard. All operations that touch Docker go through this package.

**Key exports**:
- Lifecycle: `mechaUp`, `mechaStart`, `mechaStop`, `mechaRestart`, `mechaRm`, `mechaUpdate`, `mechaPrune`
- Inspection: `mechaLs`, `mechaStatus`, `mechaLogs`, `mechaInspect`, `mechaEnv`, `mechaToken`
- Sessions: `mechaSessionCreate`, `mechaSessionList`, `mechaSessionGet`, `mechaSessionDelete`, `mechaSessionMessage`, `mechaSessionInterrupt`, `mechaSessionRename`
- Remote: `remoteSessionList`, `remoteSessionGet`, `remoteSessionDelete`, `remoteSessionMetaUpdate`
- Mesh: `agentFetch`, `MechaLocator`, `runtimeFetch`
- Config: `mechaInit`, `mechaConfigure`, `mechaDoctor`, `mechaEject`
- Endpoints: `resolveUiUrl`, `resolveMcpEndpoint`

---

## @mecha/docker

**Path**: `packages/docker/`

Thin wrapper around dockerode. Handles containers, networks, volumes, images, events.

**Key exports**:
- `createDockerClient()`, `ping(docker)`
- `createContainer()`, `startContainer()`, `stopContainer()`, `removeContainer()`
- `inspectContainer()`, `listMechaContainers()`, `getContainerLogs()`
- `getContainerPort()`, `getContainerPortAndEnv()`, `execInContainer()`
- `ensureNetwork()`, `ensureVolume()`, `pullImage()`, `imageExists()`
- `watchContainerEvents()` (SSE stream)

---

## @mecha/runtime

**Path**: `packages/runtime/`

Fastify HTTP server that runs inside each Mecha container. Manages sessions, MCP, auth.

**Key components**:
- `createServer()` — Fastify app with routes
- `SessionManager` — SQLite + JSONL session persistence
- MCP server — per-container tools (workspace access)
- Auth middleware — bearer token + TOTP validation

---

## @mecha/agent

**Path**: `packages/agent/`

Mesh networking agent server. Runs on each machine, exposes local mechas to the mesh.

**Key exports**:
- `startAgent(opts)` — Start Fastify agent server on port 7660
- `readNodes()`, `writeNodes()`, `addNode()`, `removeNode()` — Node registry
- `discoverTailscalePeers()`, `discoverMechaNodes()` — Auto-discovery
- `startHeartbeat(opts)` — Periodic node health checks

**Routes**: `/healthz`, `/mechas`, `/sessions/:id`, `/events`

---

## @mecha/mcp-server

**Path**: `packages/mcp-server/`

Mesh-level MCP server aggregating all mechas across all nodes. 12 tools in 6 groups.

**Key exports**:
- `createMeshMcpServer(opts)` — Factory function
- `runStdio(handle)` — stdio transport
- `runHttp(handle, opts)` — HTTP transport (Fastify + StreamableHTTPServerTransport)
- `DEFAULT_MCP_HTTP_PORT` (7670)

**Tools**: `mesh_list_nodes`, `mesh_list_mechas`, `mesh_mecha_status`, `mesh_list_sessions`, `mesh_get_session`, `mesh_create_session`, `mesh_query`, `mesh_delete_session`, `mesh_star_session`, `mesh_rename_session`, `mesh_workspace_list`, `mesh_workspace_read`

---

## @mecha/channels

**Path**: `packages/channels/`

Channel adapters for external messaging platforms. Currently supports Telegram.

**Key exports**:
- `createChannelGateway()` — Router for inbound messages
- `TelegramAdapter` — grammy-based Telegram bot
- `ChannelDb` — SQLite database for channel metadata and Mecha links
- Message chunking for platform limits

---

## @mecha/core

**Path**: `packages/core/`

Shared types, ID generation, constants. No runtime dependencies.

**Key exports**:
- Types: `MechaId`, `MechaState`, `MechaConfig`, `MechaInfo`, `MechaRef`, `SessionSummary`, `ParsedSession`
- `generateMechaId(slug)` — Create branded ID (format: `mx-<slug>-<hash>`)
- `DEFAULTS` — Container defaults (image, ports, paths)
- `MOUNT_PATHS` — `/home/mecha`, `/workspace`, `/state`
- `LABELS` — Docker container identification labels
- `SECURITY` — UID, dropped capabilities, readonly mounts

---

## @mecha/contracts

**Path**: `packages/contracts/`

Input/output validation and error handling.

**Key exports**:
- Zod schemas: `MechaUpInput`, `MechaExecInput`, `SessionCreateInput`, etc.
- Error types: `MechaError`, `ContainerNotFoundError`, `SessionNotFoundError`, `MechaNotLocatedError`, `NodeUnreachableError`
- Mapping: `toHttpStatus(err)`, `toExitCode(err)`, `toUserMessage(err)`, `toSafeMessage(err)`
- Permission modes: `"default"`, `"plan"`, `"full-auto"`

---

## @mecha/process

**Path**: `packages/process/`

Process management utilities.

**Key exports**:
- `ProcessManager` — Spawn and manage child processes
- `StateStore` — Track process lifecycle state
- `checkPort(port)` — Test if port is available
- `allocatePort(range)` — Find available port in range
