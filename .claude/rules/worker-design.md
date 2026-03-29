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

## States

```
offline → online ↔ busy (automatic)
            ↓
          error
```

- **offline**: definition exists, nothing running, no resources consumed.
- **online**: healthy, accepting tasks.
- **busy**: executing a task (automatic transition).
- **error**: health check failed.

## Five Verbs

- add/remove: definition lifecycle
- start/stop: resource lifecycle
- ls: observe (including health check)

## Managed Lifecycle

- **disposable**: one container per task, destroyed after.
- **persistent**: warm pool, reused across tasks.
