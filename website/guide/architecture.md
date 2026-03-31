---
title: Architecture
description: How mecha works under the hood.
---

# Architecture

## Overview

```mermaid
flowchart TB
    subgraph Host ["Host Machine"]
        CLI[mecha CLI]
        Registry[(SQLite Registry)]
        Secrets[(~/.mecha/secrets.yml)]
        CLI --> Registry
        CLI --> Secrets
    end

    subgraph Docker ["Docker"]
        C1[Claude Worker Container]
        C2[Codex Worker Container]
    end

    subgraph Remote ["Remote Machine via SSH"]
        R1["claude -p (oneshot)"]
        R2[Runtime Server + Tunnel]
    end

    subgraph Adapters ["In-Process Adapters"]
        A1[Ollama/vLLM Adapter]
    end

    CLI -->|create/start/stop| Docker
    CLI -->|ssh| Remote
    CLI -->|in-process| Adapters
```

## Components

### mecha binary (Go)

The single binary handles all worker management:

| Package | Responsibility |
|---------|---------------|
| `cmd/mecha/` | Entry point |
| `internal/cli/` | Cobra commands, Docker/SSH/adapter lifecycle glue |
| `internal/worker/` | Config, registry, Docker client, secrets, health, redaction |
| `internal/ssh/` | SSH client, runner (oneshot exec), tunnel (port forwarding) |
| `internal/adapter/` | In-process LLM API adapters (Ollama, OpenAI-compatible) |

### Worker runtime (TypeScript/Bun)

Inside each container, a Bun HTTP server receives tasks and dispatches to the backend:

- **Claude**: calls the Agent SDK `query()` directly (structured response, no subprocess)
- **Codex/Gemini**: shells out to the CLI (`codex exec` / `gemini -p`)

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

State is persisted to `~/.mecha/registry.json`:

```json
{
  "reviewer": {
    "worker": { "name": "reviewer", "docker": { ... } },
    "state": "online",
    "container_id": "abc123...",
    "runtime_endpoint": "http://127.0.0.1:32768"
  }
}
```

The file uses atomic writes (temp → fsync → rename → fsync dir) for crash safety. Permissions are set to `0600`.

### Secrets

Tokens live in `~/.mecha/secrets.yml`, referenced by `backend.name`:

```
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

### Rollback on Failure (Docker)

| Failure point | Cleanup |
|---|---|
| Create fails | Set error state, no container to clean |
| Start fails | Remove created container, set error |
| Health timeout | Stop + remove container, set error |
| Registry persist fails | Container runs, recoverable via label discovery |

### SSH Start Sequence (Oneshot)

```mermaid
sequenceDiagram
    participant U as User
    participant M as mecha
    participant R as Remote Host

    U->>M: worker start ssh-reviewer
    M->>R: SSH ping (echo ok)
    R-->>M: ok
    M->>R: which claude
    R-->>M: /usr/local/bin/claude
    M->>M: Save to registry (online, no endpoint)
    M-->>U: started ssh-reviewer (ssh/oneshot)
```

### SSH Start Sequence (Interactive)

```mermaid
sequenceDiagram
    participant U as User
    participant M as mecha
    participant R as Remote Host

    U->>M: worker start ssh-coder
    M->>R: SSH ping + check claude + check bun
    M->>R: SSH: nohup bun run server.ts (PID file)
    R-->>M: listening on :8081
    M->>M: Open SSH tunnel (localhost:random -> remote:8081)
    loop Every 2s, max 30s
        M->>R: GET /health (through tunnel)
        R-->>M: 200 OK
    end
    M->>M: Save endpoint + tunnel PID to registry
    M-->>U: started ssh-coder (ssh/interactive)
```

### Rollback on Failure (SSH)

| Failure point | Cleanup |
|---|---|
| SSH ping fails | Set error state |
| claude CLI missing | Set error state |
| Remote server crash | Set error, PID file cleaned |
| Tunnel fails | Kill remote server via PID file, set error |
| Health timeout | Stop tunnel, kill remote server, set error |

## Security Model

```mermaid
flowchart LR
    Secrets[~/.mecha/secrets.yml] -->|token resolved| Mecha
    Mecha -->|env vars| Container
    Container -->|POST /task| CLI[LLM CLI]
    CLI -->|API call| LLM[LLM API]

    Container -.-x|BLOCKED| GitHub[GitHub API]
    Mecha -->|Phase 3+| Policy
    Policy -->|filtered result| GitHub
```

- Docker workers receive LLM tokens via container env vars
- SSH workers receive tokens via temp file (sourced and deleted — never in `ps` output)
- GitHub tokens are blocked from container env
- All GitHub writes go through mecha -> Policy (Phase 3+)
- Error messages are redacted before display (13 credential patterns)
- SSH env var keys are validated against `^[a-zA-Z_][a-zA-Z0-9_]*$` to prevent injection

## Dependencies

| Dependency | Version | Purpose |
|------------|---------|---------|
| `github.com/spf13/cobra` | 1.10.2 | CLI framework |
| `gopkg.in/yaml.v3` | 3.0.1 | Worker YAML parsing |
| `github.com/moby/moby` | client 0.3.0 | Docker container management |
