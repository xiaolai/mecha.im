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

Managed workers run LLM CLIs (Claude, Codex, Gemini) inside Docker
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
- **busy**: executing a task (tracked inside container via 429 response).
- **error**: health check failed or container exited.

## Five Verbs

- add/remove: definition lifecycle (remove also cleans up container)
- start/stop: resource lifecycle (Docker create/start/stop)
- ls: observe (including health check)

## Managed Lifecycle

- **persistent**: container stays running across tasks, reused.
- **disposable**: one container per task, destroyed after (Phase 3).
