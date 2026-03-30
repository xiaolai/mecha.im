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
        Registry[(~/.mecha/registry.json)]
        Secrets[(~/.mecha/secrets.yml)]
        CLI --> Registry
        CLI --> Secrets
    end

    subgraph Docker ["Docker"]
        C1[Claude Worker Container]
        C2[Codex Worker Container]
        C3[Gemini Worker Container]
    end

    CLI -->|create/start/stop| Docker
    C1 -->|POST /task| Claude[Agent SDK query]
    C2 -->|POST /task| Codex[codex exec]
    C3 -->|POST /task| Gemini[gemini -p]
```

## Components

### mecha binary (Go)

The single binary handles all worker management:

| Package | Responsibility |
|---------|---------------|
| `cmd/mecha/` | Entry point |
| `internal/cli/` | Cobra commands, Docker lifecycle glue |
| `internal/worker/` | Config, registry, Docker client, secrets, health, redaction |

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
    Mecha -->|Phase 3+| Policy
    Policy -->|filtered result| GitHub
```

- Workers receive LLM tokens via env vars (Phase 2)
- GitHub tokens are blocked from container env
- All GitHub writes go through mecha → Policy (Phase 3+)
- Error messages are redacted before display

## Dependencies

| Dependency | Version | Purpose |
|------------|---------|---------|
| `github.com/spf13/cobra` | 1.10.2 | CLI framework |
| `gopkg.in/yaml.v3` | 3.0.1 | Worker YAML parsing |
| `github.com/moby/moby` | client 0.3.0 | Docker container management |
