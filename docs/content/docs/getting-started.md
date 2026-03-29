---
title: Getting Started
weight: 1
---

## What is Mecha

Mecha turns GitHub events into LLM tasks.

## Four Nouns

- **Event** — something happened.
- **Worker** — something that takes a prompt and returns a result.
- **Task** — an event matched to a worker. The only moving object.
- **Policy** — what a result is allowed to contain.

## One Pipeline

```
Event → Task → Worker → Result (filtered by Policy) → done
```
