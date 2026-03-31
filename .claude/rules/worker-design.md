---
description: Worker architecture — endpoint abstraction, managed/SSH/adapter/unmanaged, state machine
globs: "internal/worker/**/*.go"
---

# Worker Design

## Every Worker Is an Endpoint

```
POST /task → result
GET /health → 200
```

Same HTTP contract regardless of how the worker runs.

## Worker Types

If YAML has `docker:` section → managed (mecha controls container lifecycle).
If YAML has `adapter:` section → adapter (in-process LLM API translation).
If YAML has `ssh:` section → SSH (remote execution via SSH).
If none → unmanaged (mecha just calls the endpoint).
No `type` field. The structure is the answer.

Managed workers run LLM CLIs (Claude, Codex, Gemini) inside Docker
containers. All configuration via container env vars. Workspace
mounted from host via bind mount.

SSH workers run Claude CLI on a remote machine. Two modes:
- **oneshot**: SSH → `claude -p` → capture → return. No persistent process.
- **interactive**: SSH → start runtime server → tunnel → health check.

## States

```
offline → online ↔ busy (automatic, in-container)
            ↓
          error
```

- **offline**: definition exists, container stopped or absent.
- **online**: container running, health check passing, accepting tasks.
- **busy**: executing a task (tracked inside container via 429 response). Defined but not yet surfaced to Go registry — Phase 3.
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
adapter: ollama
upstream: http://spark01:11434
model: gemma2:9b
timeout: 10m
```

Mecha starts the adapter in-process (no sidecar, no separate binary). The
adapter handles health-check translation and request/response mapping.

Current: `scripts/ollama-adapter.py` is a reference implementation (Python,
not production). Replace with Go adapters in Phase 3.
