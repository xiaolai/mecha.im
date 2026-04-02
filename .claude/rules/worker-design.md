---
description: Worker architecture — endpoint abstraction, managed vs unmanaged, state machine
globs: "internal/worker/**/*.go"
---

# Worker Design

## Every Worker Is an Endpoint

```
POST /task → result
GET /health → 200
```

Same HTTP contract regardless of how the worker runs.

## Managed vs Unmanaged

If YAML has `docker:` section → managed (mecha controls lifecycle).
If YAML has `adapter:` section → adapter (mecha runs in-process HTTP adapter).
If YAML has `endpoint:` field → unmanaged (mecha just calls the endpoint).
No `type` field. The structure is the answer.

Managed workers run LLM CLIs (Claude, with Codex as MCP tool) inside Docker
containers. All configuration via container env vars. Workspace
mounted from host via bind mount.

## States

```
offline → online ↔ busy (automatic, in-container)
            ↓
          error
```

- **offline**: definition exists, container stopped or absent.
- **online**: container running, health check passing, accepting tasks.
- **busy**: executing a task (tracked in-container via 429, surfaced to Go registry via `SetBusy`/`SetOnline`).
- **error**: health check failed or container exited.

## Five Verbs

- add/remove: definition lifecycle (remove also cleans up container)
- start/stop: resource lifecycle (Docker create/start/stop)
- ls: observe (including health check)

## Managed Lifecycle

- **persistent**: container stays running across tasks, reused.
- **disposable**: one container per task, destroyed after.

## Adapters

Non-Docker LLM APIs (Ollama, vLLM, OpenAI-compatible, etc.) use an adapter
to translate their native API into the mecha worker contract (`GET /health` +
`POST /task`).

**Compiled-in Go adapter registry**, not dynamic plugins or sidecars.

Implemented adapters:

| Adapter | File | Upstream API |
|---|---|---|
| `ollama` | `internal/adapter/ollama.go` | Ollama `/api/chat` |
| `openai` | `internal/adapter/openai.go` | OpenAI-compatible `/v1/chat/completions` |

Workers reference an adapter by name in YAML:

```yaml
name: local-llm
adapter:
  type: ollama
  upstream: http://spark01:11434
  model: gemma2:9b
  api_key: sk-xxx          # optional, for OpenAI-compatible endpoints
timeout: 10m
```

Mecha starts the adapter in-process (no sidecar, no separate binary). The
adapter handles health-check translation and request/response mapping.
