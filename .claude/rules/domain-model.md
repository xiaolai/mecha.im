---
description: Mecha domain model — four nouns, their verbs, and the pipeline
globs: "**/*.go"
---

# Domain Model

Mecha has exactly four nouns: Event, Worker, Task, Policy.

## Pipeline

```
Event.arrive → Event.match → Task.create → Task.dispatch → Worker.execute → Policy.filter → Task.complete
```

## Nouns and Verbs

- **Event**: arrive, match
- **Worker**: add, remove, start, stop, ls
- **Task**: create, dispatch, complete, fail
- **Policy**: filter

## Rules

- Each verb belongs to exactly one noun. No orphan verbs.
- Each verb changes exactly one noun.
- Nouns don't know each other. Connected only through the pipeline.
- One noun, one lifecycle.
- No hidden nouns. Unowned logic means a missing noun.
- Verbs are idempotent where possible.
