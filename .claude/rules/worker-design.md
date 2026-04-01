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
If not → unmanaged (mecha just calls the endpoint).
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
- **disposable**: one container per task, destroyed after (Phase 3).

## Adapters (Phase 3)

Non-Docker LLM APIs (Ollama, vLLM, OpenAI-compatible, etc.) need an adapter
to translate their native API into the mecha worker contract (`GET /health` +
`POST /task`).

Design: **compiled-in Go adapter registry**, not dynamic plugins or sidecars.

```
adapter/
  ollama.go     → Ollama /api/chat → worker contract
  openai.go     → OpenAI /v1/chat/completions → worker contract
  litellm.go    → LiteLLM proxy → worker contract
```

Each adapter is a Go package implementing a common interface. Workers reference
an adapter by name in YAML:

```yaml
name: local-llm
adapter:
  type: ollama
  upstream: http://spark01:11434
  model: gemma2:9b
timeout: 10m
```

Mecha starts the adapter in-process (no sidecar, no separate binary). The
adapter handles health-check translation and request/response mapping.

Current: `scripts/ollama-adapter.py` is a reference implementation (Python,
not production). Replace with Go adapters in Phase 3.
