# Service Layer Reference

**Package**: `@mecha/service` (`packages/service/`)

The service layer contains all business logic. It is the single source of truth for operations — both CLI and dashboard call into it.

## Lifecycle Operations

**Source**: `packages/service/src/lifecycle.ts`

| Function | Description |
|----------|-------------|
| `mechaUp(docker, config)` | Create and start a Mecha container. Pulls image, creates container with security constraints, mounts workspace, starts it. |
| `mechaStart(docker, id)` | Start a stopped container. |
| `mechaStop(docker, id)` | Stop a running container. |
| `mechaRestart(docker, id)` | Stop then start a container. |
| `mechaRm(docker, {id, withState, force})` | Remove container. Optionally remove state volume and force-stop. |
| `mechaPrune(docker, {volumes})` | Remove all stopped Mecha containers. Optionally remove orphaned volumes. |
| `mechaUpdate(docker, {id, noPull})` | Pull latest image, recreate container preserving config. |

## Inspection & Configuration

**Source**: `packages/service/src/inspect.ts`, `packages/service/src/configure.ts`

| Function | Description |
|----------|-------------|
| `mechaLs(docker)` | List all local Mechas with state, port, path. |
| `mechaStatus(docker, id)` | Detailed status: state, uptime, port, image, resources. |
| `mechaLogs(docker, {id, follow, tail, since})` | Stream container logs as ReadableStream. |
| `mechaInspect(docker, id)` | Raw Docker container JSON. |
| `mechaEnv(docker, id)` | List environment variables. |
| `mechaToken(docker, id)` | Get auth token from container env. |
| `resolveUiUrl(docker, id)` | Get UI URL (host:port + auth token). |
| `resolveMcpEndpoint(docker, id)` | Get MCP endpoint URL + token. |
| `mechaInit(docker)` | Create Docker network and volumes. |
| `mechaConfigure(docker, {id, ...})` | Update env vars on running container. |
| `mechaDoctor(docker)` | Check Docker daemon, network, system requirements. |
| `mechaEject(docker, {id, force})` | Export as docker-compose.yml + .env. |

## Session Operations

**Source**: `packages/service/src/sessions.ts`

| Function | Description |
|----------|-------------|
| `mechaSessionCreate(docker, {id, title})` | Create new session via runtime API. |
| `mechaSessionList(docker, {id})` | List all sessions for a Mecha. |
| `mechaSessionGet(docker, {id, sessionId})` | Get session with full message history. |
| `mechaSessionDelete(docker, {id, sessionId})` | Delete a session. |
| `mechaSessionMessage(docker, {id, sessionId, role, content})` | Send message (returns SSE stream). |
| `mechaSessionInterrupt(docker, {id, sessionId})` | Interrupt active task in session. |
| `mechaSessionRename(docker, {id, sessionId, title})` | Rename a session. |
| `mechaSessionConfigUpdate(docker, {id, sessionId, config})` | Update session config. |

## Remote Session Operations

**Source**: `packages/service/src/remote-sessions.ts`

These functions work with both local and remote mechas via the `RemoteTarget` type.

| Function | Description |
|----------|-------------|
| `remoteSessionList(docker, mechaId, target)` | List sessions. If target is local, calls Docker. If remote, uses `agentFetch`. |
| `remoteSessionGet(docker, mechaId, sessionId, target)` | Get session details (local or remote). |
| `remoteSessionDelete(docker, mechaId, sessionId, target)` | Delete session (local or remote). |
| `remoteSessionMetaUpdate(mechaId, sessionId, meta, target)` | Update metadata (star, rename) via agent or local runtime. |

```typescript
type RemoteTarget = {
  node: "local" | string;
  entry?: NodeEntry;
};
```

## Chat

**Source**: `packages/service/src/chat.ts`

| Function | Description |
|----------|-------------|
| `mechaChat(docker, {id, message, sessionId})` | Send chat message, returns ReadableStream of SSE events. |

## Mesh Utilities

### Agent Client

**Source**: `packages/service/src/agent-client.ts`

| Function | Description |
|----------|-------------|
| `agentFetch(nodeEntry, path, options)` | HTTP fetch to a remote agent node. Adds bearer auth header, handles timeouts. |

```typescript
interface AgentFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;  // 0 = no timeout
}
```

### Mecha Locator

**Source**: `packages/service/src/locator.ts`

```typescript
class MechaLocator {
  locate(docker, mechaId, nodes): Promise<{ node: "local" | string; entry?: NodeEntry }>
  invalidate(mechaId): void
}
```

Resolves a Mecha ID to its location:
1. Check local Docker first
2. If not found locally, query all registered nodes via `agentFetch`
3. Cache the result for subsequent calls
4. `invalidate()` clears cache on error (used by MCP server error handler)

### Runtime Fetch

**Source**: `packages/service/src/helpers.ts`

| Function | Description |
|----------|-------------|
| `runtimeFetch(docker, mechaId, path, options)` | Fetch from a local Mecha's runtime API. Resolves container port, adds auth header. |

## Environment

**Source**: `packages/service/src/env.ts`

| Function | Description |
|----------|-------------|
| `loadDotEnvFiles(projectPath, cwd)` | Load `.env` files from project path. |
| `getMechaPath(docker, id)` | Get the mounted project path for a Mecha. |
