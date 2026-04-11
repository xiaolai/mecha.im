---
title: Adapter Workers
description: Connect non-Docker LLM APIs (Ollama, vLLM, OpenAI-compatible) to mecha.
---

# Adapter Workers

Adapters translate native LLM APIs into the mecha worker contract (`GET /health`, `POST /task`). They run in-process — no Docker required.

## When to Use Adapters

| Use case | Worker type |
|---|---|
| Claude/Codex in Docker | **Managed** (`docker:` section) |
| Ollama, vLLM, LiteLLM, llama.cpp | **Adapter** (`adapter:` section) |
| External HTTP endpoint you control | **Unmanaged** (`endpoint:` field) |

Adapters are ideal for local LLMs where you don't need Docker isolation but want mecha's lifecycle management (start/stop/health).

## Supported Adapters

| Type | Upstream API | Health Check | Source |
|---|---|---|---|
| `ollama` | `/api/chat` | `GET /` | `internal/adapter/ollama.go` |
| `openai` | `/v1/chat/completions` | `GET /v1/models` | `internal/adapter/openai.go` |

## Configuration

### Ollama

```yaml
name: local-ollama
adapter:
  type: ollama
  upstream: http://localhost:11434
  model: gemma2:9b
timeout: 10m
```

### OpenAI-Compatible

Works with vLLM, LiteLLM, llama.cpp server, or any OpenAI-compatible endpoint:

```yaml
name: vllm-worker
adapter:
  type: openai
  upstream: http://gpu-server:8000
  model: meta-llama/Llama-3-70b
  api_key: ${VLLM_API_KEY}
timeout: 15m
```

### Fields

| Field | Required | Description |
|---|---|---|
| `adapter.type` | Yes | `ollama` or `openai` |
| `adapter.upstream` | Yes | Base URL of the LLM API |
| `adapter.model` | Yes | Model name passed to the API |
| `adapter.api_key` | No | Inline API key for authenticated endpoints. **Not persisted** to SQLite (in-memory only) — use `adapter.token` for restart-safe secrets |
| `adapter.token` | No | `~/.mecha/secrets.yml` reference (e.g. `codex.default`). Resolved at adapter start, persists across restarts |

Prefer `adapter.token` over `adapter.api_key`: the token is stored as a
reference (not the raw value) and survives `mecha serve` restarts. The
in-memory `api_key` is intentionally `json:"-"` so raw keys never land in
`mecha.db`.

## How It Works

```mermaid
sequenceDiagram
    participant M as mecha
    participant A as Adapter (in-process)
    participant L as LLM API

    M->>A: worker start local-ollama
    A->>L: GET / (health check)
    L-->>A: 200 OK
    A-->>M: online

    M->>A: POST /task {"prompt": "..."}
    A->>L: POST /api/chat {"model": "gemma2:9b", "messages": [...]}
    L-->>A: {"message": {"content": "..."}}
    A-->>M: {"output": "...", "metadata": {...}}
```

When `mecha serve` starts, it auto-starts any offline adapter workers in-process.
Each adapter runs an HTTP server that:

1. Translates `GET /health` into the upstream's native health endpoint
2. Translates `POST /task` into the upstream's chat completion API
3. Converts the upstream response into the mecha result contract

The adapter server binds to a random loopback port. Mecha records the endpoint
in the registry like any other worker, and stops the adapter on graceful shutdown.

## Lifecycle

Adapters run in-process and are auto-started by `mecha serve`. You do not run
`mecha worker start` on an adapter — the CLI rejects that with an error
explaining adapters are started by the server.

```bash
# Add the worker definition
mecha worker add workers/ollama-gemma.yml

# Start mecha serve — any adapter workers come up automatically
mecha serve

# In another terminal, check status
mecha worker ls
# NAME          TYPE     STATE   ENDPOINT                    HEALTH
# local-ollama  adapter  online  http://127.0.0.1:52431      ok
```

Adapter workers follow the same state machine as managed workers:
`offline → online ↔ busy → error`. They stop when the server shuts down (the
runners are drained as part of graceful shutdown).

## Comparison with Unmanaged Workers

| Feature | Adapter | Unmanaged |
|---|---|---|
| Lifecycle management | Yes (start/stop) | No (always running externally) |
| Health translation | Yes (native API → worker contract) | No (must implement /health natively) |
| In-process | Yes | No |
| Docker required | No | No |
| Custom API translation | Automatic | Manual (your endpoint must speak worker contract) |

## Adding Custom Adapters

Adapters are compiled-in Go packages implementing the `adapter.Adapter` interface:

```go
type Adapter interface {
    Name() string
    Health(ctx context.Context) error
    SendTask(ctx context.Context, prompt string) ([]byte, error)
}
```

See `internal/adapter/ollama.go` for a reference implementation.
