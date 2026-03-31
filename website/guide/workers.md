---
title: Worker Configuration
description: All worker YAML fields explained with examples.
---

# Worker Configuration

Workers are defined in YAML files. Each file describes one worker.

## Managed vs Unmanaged

```mermaid
flowchart TD
    YAML{YAML structure?}
    YAML -->|has docker:| Managed[Managed Worker]
    YAML -->|has adapter:| Adapter[Adapter Worker]
    YAML -->|has endpoint:| Unmanaged[Unmanaged Worker]
    Managed --> Docker[mecha creates/starts Docker container]
    Adapter --> InProcess[mecha runs in-process HTTP adapter]
    Unmanaged --> Endpoint[mecha calls existing HTTP endpoint]
```

- **Managed**: has a `docker:` section. Mecha controls the Docker container lifecycle.
- **Adapter**: has an `adapter:` section. Mecha runs an in-process adapter translating a native LLM API.
- **Unmanaged**: has an `endpoint:` field. Mecha just calls it.

## Managed Worker (Docker)

```yaml
name: claude-reviewer
docker:
  image: mecha-worker-claude:latest     # required
  cwd: /path/to/project                 # host dir → /workspace in container
  resources:
    cpu: 4                              # CPU cores
    memory: 8G                          # memory limit (M or G)
    pids: 256                           # process limit
  lifecycle: persistent                 # "persistent" (default) or "disposable"
  env:                                  # environment variables
    CLAUDE_MODEL: claude-sonnet-4-6
    CLAUDE_SYSTEM_PROMPT: "You review code."
    CLAUDE_ALLOWED_TOOLS: "Read,Grep,Glob,Bash"
    CLAUDE_PERMISSION_MODE: bypassPermissions
    CLAUDE_EFFORT: high
    CLAUDE_OUTPUT_FORMAT: json
  token: claude.xiaolaidev              # from ~/.mecha/secrets.yml
  labels:                               # custom Docker labels
    team: security
timeout: 30m                            # task timeout
```

### Fields

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `name` | Yes | — | Unique worker name. Must match `[a-zA-Z0-9][a-zA-Z0-9_.-]*` |
| `docker.image` | Yes | — | Docker image to run |
| `docker.cwd` | No | — | Host directory mounted read-write to `/workspace` |
| `docker.resources.cpu` | No | unlimited | CPU cores |
| `docker.resources.memory` | No | unlimited | Memory limit (`512M`, `4G`) |
| `docker.resources.pids` | No | unlimited | Max processes |
| `docker.lifecycle` | No | `persistent` | `persistent` (reuse container) or `disposable` (new container per task) |
| `docker.host` | No | local socket | Docker daemon URL (e.g. `unix:///var/run/docker.sock`) |
| `docker.env` | No | `{}` | Environment variables passed to container |
| `docker.token` | No | — | Token reference from `~/.mecha/secrets.yml` |
| `docker.expose` | No | `false` | Bind to `0.0.0.0` instead of `127.0.0.1` (network-accessible) |
| `docker.api_key` | No | — | Bearer auth key for `/task` endpoint. **Required** when `expose: true` |
| `docker.labels` | No | `{}` | Custom Docker container labels |
| `timeout` | No | `10m` | Max task execution time |

### Workspace Mount

When `docker.cwd` is set, the directory is bind-mounted read-write into the container at `/workspace`. The container runs as your host user (matching UID/GID) to avoid permission issues.

```yaml
docker:
  cwd: /Users/me/projects/my-repo    # must be an existing directory
```

The path is validated:
- Must exist and be a directory (not a file)
- Symlinks are resolved before checking (no traversal)
- Sensitive host paths are blocked:

| Blocked Paths | Reason |
|---------------|--------|
| `/etc`, `/proc`, `/sys`, `/dev`, `/boot` | System directories |
| `~/.ssh`, `~/.gnupg` | Credential stores |
| `~/.aws`, `~/.config/gcloud` | Cloud credentials |
| `~/.mecha` | Mecha's own config and secrets |

`mecha doctor` re-checks these paths for workers already in the registry.

### Disposable (One-Shot) Containers

Set `lifecycle: disposable` to create a fresh container per task. The container is destroyed after the task completes.

```yaml
name: sandbox-runner
docker:
  image: mecha-worker-claude:latest
  lifecycle: disposable
  token: claude.xiaolaidev
timeout: 10m
```

- **persistent** (default): container stays running, reused across tasks
- **disposable**: new container per task, destroyed after completion

Disposable workers don't need `worker start` — the dispatch loop creates containers on demand.

## Adapter Worker

Adapters translate native LLM APIs (Ollama, vLLM, OpenAI-compatible) into the mecha worker contract. They run in-process — no Docker required.

```yaml
name: local-llm
adapter:
  type: ollama                       # "ollama" or "openai"
  upstream: http://localhost:11434   # base URL of the LLM API
  model: gemma2:9b                   # model name
timeout: 10m
```

### Adapter Types

| Type | Upstream API | Health Check | Task Endpoint |
|------|-------------|--------------|---------------|
| `ollama` | Ollama `/api/chat` | `GET /` | Chat completions |
| `openai` | OpenAI-compatible `/v1/chat/completions` | `GET /v1/models` | Chat completions |

### OpenAI-Compatible Example

Works with vLLM, LiteLLM, llama.cpp server, or any OpenAI-compatible API:

```yaml
name: vllm-worker
adapter:
  type: openai
  upstream: http://gpu-server:8000
  model: meta-llama/Llama-3-70b
  api_key: ${VLLM_API_KEY}          # optional
timeout: 15m
```

### Fields

| Field | Required | Description |
|-------|----------|-------------|
| `adapter.type` | Yes | `ollama` or `openai` |
| `adapter.upstream` | Yes | Base URL of the LLM API |
| `adapter.model` | Yes | Model name passed to the API |
| `adapter.api_key` | No | API key for authenticated endpoints |

Mecha starts an in-process HTTP server when you run `worker start`. The adapter translates the worker contract (`GET /health`, `POST /task`) into native API calls.

## Unmanaged Worker

```yaml
name: my-ollama
endpoint: http://100.64.0.3:11434
timeout: 5m
```

Mecha doesn't manage the process. It just marks the worker online on `start`, probes `GET /health`, and calls `POST /task` on the endpoint.

## Worker Image Contract

Every managed worker image must:

| Requirement | Details |
|-------------|---------|
| Port | Expose `8080` |
| Health | `GET /health` → `200` (ready) or `503` (busy) |
| Task | `POST /task` → result contract JSON |
| Healthcheck | Include `HEALTHCHECK` directive in Dockerfile |
| Config | Read all config from environment variables |
| Backend | Set `WORKER_BACKEND` env var (`claude`, `codex`, `gemini`) |

### POST /task Request

```json
{
  "id": "task-abc123",
  "prompt": "Review this PR for security issues",
  "context": {
    "repo": "owner/repo",
    "diff": "..."
  }
}
```

### POST /task Response

```json
{
  "output": "The PR has a SQL injection vulnerability...",
  "metadata": {
    "model": "claude-sonnet-4-6",
    "duration_ms": 45000,
    "exit_code": 0
  }
}
```

## Backend-Specific Env Vars

### Claude

Claude uses the Agent SDK `query()` directly. Env vars map to SDK options:

| Env Var | SDK Option | Values |
|---------|-----------|--------|
| `CLAUDE_MODEL` | `model` | `claude-sonnet-4-6`, `claude-opus-4-6`, etc. |
| `CLAUDE_SYSTEM_PROMPT` | `systemPrompt` | Any string |
| `CLAUDE_ALLOWED_TOOLS` | `allowedTools` | Comma-separated: `Read,Grep,Glob,Bash` |
| `CLAUDE_DISALLOWED_TOOLS` | `disallowedTools` | Comma-separated |
| `CLAUDE_PERMISSION_MODE` | `permissionMode` | `default`, `plan`, `acceptEdits`, `bypassPermissions` |
| `CLAUDE_EFFORT` | `effort` | `low`, `medium`, `high`, `max` |
| `CLAUDE_MAX_BUDGET_USD` | `maxBudgetUsd` | e.g. `5.00` |
| `CLAUDE_MAX_TURNS` | `maxTurns` | e.g. `50` |

### Codex

Codex uses `codex exec` CLI. Env vars map to CLI flags:

| Env Var | CLI Flag | Values |
|---------|----------|--------|
| `CODEX_MODEL` | `--model` | `gpt-5.4`, `gpt-5.4-mini`, etc. |
| `CODEX_SANDBOX` | `--sandbox` | `read-only`, `workspace-write`, `danger-full-access` |
| `CODEX_FULL_AUTO` | `--full-auto` | `"true"` to enable auto-approve + workspace-write |
| `CODEX_EFFORT` | `-c model_reasoning_effort` | `low`, `medium`, `high` |

### Gemini

| Env Var | CLI Flag | Values |
|---------|----------|--------|
| `GEMINI_MODEL` | `--model` | `gemini-2.5-pro`, `gemini-2.5-flash`, etc. |
| `GEMINI_SANDBOX` | `--sandbox` | `"true"` to enable sandboxed execution |
| `GEMINI_APPROVAL_MODE` | `--approval-mode` | `default`, `auto_edit`, `yolo`, `plan` |
| `GEMINI_OUTPUT_FORMAT` | `--output-format` | `text`, `json`, `stream-json` |

## State Machine

```mermaid
stateDiagram-v2
    [*] --> offline : worker add
    offline --> online : worker start
    online --> busy : task dispatched
    busy --> online : task complete
    online --> offline : worker stop
    online --> error : health check failed
    error --> offline : worker stop
    offline --> [*] : worker remove
```

- **offline**: definition exists, container stopped or absent
- **online**: container running, health check passing, accepting tasks
- **busy**: executing a task (returns 429 to new requests)
- **error**: health check failed or container exited
