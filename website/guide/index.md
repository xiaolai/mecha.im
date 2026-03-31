---
title: Introduction
description: What Mecha is and why it exists.
---

# What is Mecha

**Mecha is a workflow engine that runs LLM agents inside Docker containers, managed by a single Go binary.**

## The Problem

You want multiple AI agents — a code reviewer, a bug triager, a doc writer — each with its own model, tools, and permissions. Without mecha, you manage each one manually: start containers, inject tokens, check health, clean up.

## The Solution

Mecha gives you a YAML-driven lifecycle for LLM workers:

```
mecha worker add workers/reviewer.yml    # define it
mecha worker start reviewer              # run it (Docker container)
curl http://localhost:32768/task          # use it
mecha worker stop reviewer               # stop it
```

One binary. One YAML per worker. Docker handles isolation.

## How It Works

```mermaid
flowchart LR
    YAML[Worker YAML] --> Add[mecha worker add]
    Add --> Registry[(Registry)]
    Registry --> Start[mecha worker start]
    Start --> Docker[Docker Container]
    Docker --> Health[GET /health → 200]
    Docker --> Task[POST /task → result]
    Task --> CLI[claude/codex/gemini CLI]
```

Each worker is a Docker container running an LLM CLI (Claude, Codex, or Gemini). Mecha creates the container, injects auth tokens, waits for health, and tracks state. You interact with workers via HTTP.

## Four Nouns

The full system (when complete) is built on four concepts:

- **Event** — something happened (webhook, schedule, API call)
- **Worker** — takes a prompt, returns a result (Docker container, adapter, or external endpoint)
- **Task** — an event matched to a worker
- **Policy** — what a result is allowed to contain

## Pipeline

```mermaid
flowchart LR
    E[Event.arrive] --> M[Event.match]
    M --> C[Task.create]
    C --> D[Task.dispatch]
    D --> F[Policy.filter]
    F --> T[Task.complete]
```

All four nouns and the full pipeline are implemented. Events arrive via webhooks, match to workers, create tasks, get dispatched, pass through policy filtering, and complete with write-back to GitHub.
