---
title: Architecture
description: How mecha works under the hood.
---

# Architecture

## Overview

```mermaid
flowchart TB
    subgraph Inbound ["Event Sources"]
        GH[GitHub Webhooks]
        GL[GitLab Webhooks]
        SL[Slack Events]
        TG[Telegram Updates]
        CR[Cron Triggers]
        MCP[MCP Clients]
    end

    subgraph Mecha ["mecha serve :21212"]
        Router[Event Router]
        Queue[Task Queue + Retry]
        Policy[Policy Filter]
        WB[Write-Back]
    end

    subgraph Workers ["Workers"]
        DK[Docker Containers]
        AD[Adapter - Ollama/OpenAI]
        LV[Live Endpoints]
    end

    subgraph Storage ["Storage"]
        DB[(mecha.db)]
        Secrets[(secrets.yml)]
        Config[(config.yml)]
    end

    GH & GL & SL & TG & CR -->|webhooks| Router
    MCP -->|POST /task| Queue
    Router -->|match + hydrate| Queue
    Queue -->|dispatch| Workers
    Workers -->|result| Policy
    Policy -->|filtered| WB
    WB -->|comments, labels, status| GH & GL
    Mecha --> DB
    Mecha --> Secrets
    Mecha --> Config
```

## Components

### mecha binary (Go)

The single binary handles worker management, event routing, task dispatch, and policy enforcement:

| Package | Responsibility |
|---------|---------------|
| `cmd/mecha/` | CLI entry point |
| `cmd/mecha-mcp/` | MCP server (14 tools: docs + orchestration) |
| `internal/cli/` | Cobra commands, Docker lifecycle, adapter management |
| `internal/serve/` | HTTP server, dispatch loop, retry, rate limiter, metrics |
| `internal/source/` | Event sources: GitHub, GitLab, Slack, Telegram, Cron, Generic |
| `internal/events/` | Event types, store, dedup enforcement |
| `internal/tasks/` | Task lifecycle, retry with exponential backoff |
| `internal/policies/` | Policy filter: comment, labels, status, commit, metadata |
| `internal/adapter/` | LLM adapters: Ollama, OpenAI-compatible |
| `internal/workers/` | Config, registry, Docker client, secrets, health, redaction |
| `internal/writeback/` | GitHub write-back (comments, labels, status, diffs) |
| `internal/store/` | SQLite database, versioned migrations (V1-V5) |

### Worker runtime (TypeScript/Bun)

Inside each container, a Bun HTTP server receives tasks and dispatches to the backend:

- **Claude**: calls the Agent SDK `query()` directly (structured response, no subprocess)
- **Codex**: available as an MCP child process within the Claude session (auto-detected via credential mount)

```mermaid
sequenceDiagram
    participant M as mecha
    participant S as Bun server (port 8080)
    participant SDK as Agent SDK

    M->>S: POST /task {"prompt": "..."}
    S->>S: Check busy flag
    S->>SDK: query({prompt, options})
    SDK-->>S: SDKResultMessage
    S-->>M: {"output": "...", "metadata": {...}}
```

The server is single-flight: one task at a time. A second request while busy returns `429 Too Many Requests`.

### Registry

State is persisted to `~/.mecha/mecha.db` (SQLite, WAL mode):

| Table | Purpose |
|---|---|
| `workers` | Worker definitions + runtime state (JSON) |
| `tasks` | Task lifecycle (pending → dispatched → completed/failed) |
| `events` | Webhook events + matching state |

The registry uses clone-on-write: mutations clone the in-memory map, persist to SQLite in a transaction, then swap the pointer. On persistence failure, in-memory state is unchanged.

### Secrets

Tokens live in `~/.mecha/secrets.yml`, referenced by `backend.name`:

```text
docker.token: claude.xiaolaidev
  → secrets.yml lookup
  → sk-ant-oat01-xxx...
  → detect prefix → CLAUDE_CODE_OAUTH_TOKEN
  → inject into container env
```

See [Secrets](./secrets) for full details.

## Worker Lifecycle

```mermaid
stateDiagram-v2
    [*] --> offline : add
    offline --> online : start
    online --> offline : stop
    online --> error : health check failed
    error --> offline : stop
    offline --> [*] : remove

    note right of offline : Definition exists, container stopped
    note right of online : Container running, health passing
    note right of error : Health check failed or container exited
```

### Docker Start Sequence

```mermaid
sequenceDiagram
    participant U as User
    participant M as mecha
    participant D as Docker
    participant C as Container

    U->>M: worker start reviewer
    M->>M: Load secrets, build env
    M->>D: Remove old container (crash recovery)
    M->>D: Create container (env, mounts, resources)
    M->>D: Start container
    loop Every 2s, max 30s
        M->>C: GET /health
        C-->>M: 200 OK
    end
    M->>M: Save containerID + endpoint to registry
    M-->>U: started reviewer (container)
```

### Rollback on Failure

| Failure point | Cleanup |
|---|---|
| Create fails | Set error state, no container to clean |
| Start fails | Remove created container, set error |
| Health timeout | Stop + remove container, set error |
| Registry persist fails | Container runs, recoverable via label discovery |

## Security Model

```mermaid
flowchart LR
    Secrets[~/.mecha/secrets.yml] -->|token resolved| Mecha
    Mecha -->|env vars| Container
    Container -->|POST /task| CLI[LLM CLI]
    CLI -->|API call| LLM[LLM API]

    Container -.-x|BLOCKED| GitHub[GitHub API]
    Mecha --> Policy
    Policy -->|filtered result| GitHub
```

- Workers receive LLM tokens via env vars or credential mounts
- GitHub tokens are blocked from container env
- All GitHub writes go through mecha → Policy
- Error messages are redacted before display

## Dependencies

| Dependency | Version | Purpose |
|------------|---------|---------|
| `github.com/spf13/cobra` | 1.10.2 | CLI framework |
| `gopkg.in/yaml.v3` | 3.0.1 | Worker YAML parsing |
| `github.com/moby/moby/api` | 1.54.0 | Docker API types |
| `github.com/moby/moby/client` | 0.3.0 | Docker container management |
| `modernc.org/sqlite` | 1.48.0 | SQLite persistence (workers, tasks, events) |
