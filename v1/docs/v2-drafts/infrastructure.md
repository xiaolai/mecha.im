# Infrastructure Reference

## Docker Management (@mecha/docker)

**Path**: `packages/docker/`

Thin abstraction over dockerode. All Docker interactions go through this package.

### Client

| Function | Description |
|----------|-------------|
| `createDockerClient()` | Initialize dockerode client (uses DOCKER_HOST or default socket) |
| `ping(docker)` | Test Docker daemon connectivity |

### Container Operations

| Function | Description |
|----------|-------------|
| `createContainer(docker, opts)` | Create container with full config (image, env, ports, mounts, security) |
| `startContainer(docker, id)` | Start container |
| `stopContainer(docker, id)` | Stop container |
| `removeContainer(docker, id, {force, volumes})` | Remove container |
| `inspectContainer(docker, id)` | Get raw container metadata |
| `listMechaContainers(docker)` | List containers with `mecha=true` label |
| `getContainerLogs(docker, id, {follow, tail, since})` | Stream logs |
| `getContainerPort(docker, id)` | Get published host port |
| `getContainerPortAndEnv(docker, id)` | Get port + environment variables |
| `execInContainer(docker, id, {cmd, env, workdir})` | Execute command in running container |

### Network

| Function | Description |
|----------|-------------|
| `ensureNetwork(docker, name)` | Create network if it doesn't exist |
| `removeNetwork(docker, name)` | Remove network |

### Volumes

| Function | Description |
|----------|-------------|
| `ensureVolume(docker, name)` | Create volume if it doesn't exist |
| `removeVolume(docker, name)` | Remove volume |

### Images

| Function | Description |
|----------|-------------|
| `pullImage(docker, image)` | Pull image from registry |
| `imageExists(docker, image)` | Check if image exists locally |

### Events

| Function | Description |
|----------|-------------|
| `watchContainerEvents(docker, opts)` | SSE stream of Docker container lifecycle events |

---

## Core Types (@mecha/core)

**Path**: `packages/core/`

### Identity

```typescript
type MechaId = string & { __brand: "MechaId" };
// Format: mx-<slug>-<6char_hash>
// Example: mx-my-project-a1b2c3

function generateMechaId(slug: string): MechaId;
```

### State Machine

```typescript
type MechaState =
  | "creating"
  | "running"
  | "stopped"
  | "removing"
  | "error"
  | "not_found";
```

### Configuration

```typescript
interface MechaConfig {
  projectPath: string;
  port?: number;
  claudeToken?: string;
  anthropicApiKey?: string;
  otp?: string;
  permissionMode?: "default" | "plan" | "full-auto";
  env?: Record<string, string>;
}
```

### Info

```typescript
interface MechaInfo {
  id: MechaId;
  name: string;
  state: MechaState;
  port?: number;
  path?: string;
  image?: string;
  created?: string;
  uptime?: string;
}
```

### Mesh Reference

```typescript
interface MechaRef {
  id: MechaId;
  node: "local" | string;
  entry?: NodeEntry;
}
```

### Session Types

```typescript
interface SessionSummary {
  id: string;
  title?: string;
  createdAt: string;
  updatedAt?: string;
  messageCount?: number;
  starred?: boolean;
}

interface ParsedSession {
  id: string;
  title?: string;
  messages: ParsedMessage[];
  createdAt: string;
  updatedAt?: string;
  starred?: boolean;
}

interface ParsedMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: string;
}
```

### Constants

```typescript
const DEFAULTS = {
  IMAGE: "ghcr.io/anthropics/claude-code:latest",
  CONTAINER_PORT: 7681,
  HOME_DIR: "/home/mecha",
};

const MOUNT_PATHS = {
  HOME: "/home/mecha",
  WORKSPACE: "/workspace",
  STATE: "/state",
};

const LABELS = {
  MECHA: "mecha",
  ID: "mecha.id",
  NAME: "mecha.name",
  PATH: "mecha.path",
};

const SECURITY = {
  USER_ID: 1000,
  DROP_CAPS: ["NET_RAW", "SYS_ADMIN", ...],
  READONLY_PATHS: ["/usr", "/bin", "/sbin", "/lib"],
};
```

---

## Contracts (@mecha/contracts)

**Path**: `packages/contracts/`

### Zod Schemas

Input validation for all operations:

| Schema | Used By |
|--------|---------|
| `MechaUpInput` | `mecha up` / POST `/api/mechas` |
| `MechaExecInput` | `mecha exec` / POST `/api/mechas/[id]/exec` |
| `SessionCreateInput` | Session creation |
| `SessionMessageInput` | Session message send |
| `SessionConfigInput` | Session config update |

### Error Types

```typescript
class MechaError extends Error {
  code: string;
  statusCode: number;
  exitCode: number;
}

class ContainerNotFoundError extends MechaError {}
class SessionNotFoundError extends MechaError {}
class MechaNotLocatedError extends MechaError {}
class NodeUnreachableError extends MechaError {}
class ImageNotFoundError extends MechaError {}
class PortConflictError extends MechaError {}
```

### Error Mapping

| Function | Description |
|----------|-------------|
| `toHttpStatus(err)` | Map error to HTTP status code (404, 409, 500, etc.) |
| `toExitCode(err)` | Map error to CLI exit code (1, 2, etc.) |
| `toUserMessage(err)` | Human-readable error message |
| `toSafeMessage(err)` | Safe message for external display (strips internals) |

### Permission Modes

| Mode | Description |
|------|-------------|
| `default` | Limited permissions, confirmation required for destructive ops |
| `plan` | Planning mode — can read and propose but not execute |
| `full-auto` | Autonomous mode — can execute without confirmation |

---

## Channels (@mecha/channels)

**Path**: `packages/channels/`

### Components

| Component | Description |
|-----------|-------------|
| `TelegramAdapter` | grammy-based Telegram bot adapter |
| `ChannelGateway` | Router for inbound messages → linked Mecha |
| `ChannelDb` | SQLite database for channel metadata and links |

### Database Schema

```sql
-- Channel gateways
CREATE TABLE channels (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,        -- 'telegram'
  config TEXT NOT NULL,      -- JSON (bot token, etc.)
  created_at TEXT NOT NULL
);

-- Channel → Mecha links
CREATE TABLE links (
  channel_id TEXT NOT NULL,
  mecha_id TEXT NOT NULL,
  chat_id TEXT,              -- platform-specific chat ID
  created_at TEXT NOT NULL
);
```

### Message Flow

```
Telegram → TelegramAdapter → ChannelGateway → linked Mecha → SSE response → chunked reply
```

Messages exceeding platform limits (Telegram: 4096 chars) are automatically chunked.

---

## Process Management (@mecha/process)

**Path**: `packages/process/`

| Component | Description |
|-----------|-------------|
| `ProcessManager` | Spawn and manage child processes with lifecycle tracking |
| `StateStore` | Persistent state tracking for managed processes |
| `checkPort(port)` | Test if a port is available |
| `allocatePort(range)` | Find an available port in a given range |

---

## Runtime (@mecha/runtime)

**Path**: `packages/runtime/`

The runtime is the Fastify HTTP server that runs inside each Mecha container.

### Server Routes

| Route | Description |
|-------|-------------|
| `GET /healthz` | Liveness probe |
| `GET /info` | Runtime metadata (version, uptime, config) |
| `GET /sessions` | List sessions |
| `POST /sessions` | Create session |
| `GET /sessions/:id` | Get session with messages |
| `DELETE /sessions/:id` | Delete session |
| `POST /sessions/:id/message` | Send message (SSE streaming) |
| `POST /sessions/:id/interrupt` | Interrupt active task |
| `PATCH /sessions/:id` | Update session metadata |
| `/mcp` | Per-container MCP endpoint |

### Session Manager

- SQLite database for session metadata
- JSONL transcripts for message persistence (source of truth)
- Imports existing JSONL files on startup
- Resets "busy" sessions on restart
- Configurable execution timeout

### Authentication

- **Bearer token**: Generated at container creation, validated on every request
- **TOTP**: Time-based one-time password for browser access (optional)

### Per-Container MCP

Each Mecha container exposes its own MCP server with workspace tools:
- `mecha_workspace_list` — list files in `/workspace`
- `mecha_workspace_read` — read file content

---

## Security Model

### Container Isolation

| Feature | Implementation |
|---------|---------------|
| Read-only rootfs | `ReadonlyRootfs: true` |
| Dropped capabilities | `NET_RAW`, `SYS_ADMIN`, etc. |
| Non-root user | UID 1000 |
| Tmpfs for writable paths | `/tmp`, `/var/run` |
| Network isolation | Custom Docker bridge network |

### Trust Boundary

Secrets (`CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`, `MECHA_OTP`) are passed as container environment variables. This is acceptable when Docker socket access is controlled — anyone with Docker socket access can already read container env.

### Mesh Authentication

Node-to-node communication uses bearer tokens (API keys) stored in `~/.mecha/nodes.json`. All agent routes require authentication.
