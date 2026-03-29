---
title: "Getting Started"
description: "Learn what Mecha is and how it works."
icon: rocket_launch
weight: 100
draft: false
toc: true
---

## What is Mecha

**Agentic Workflow Engine: Scheduling, Orchestrating, Managing Events.**

## Four Nouns

The entire system is built on four concepts:

- **Event** — something happened.
- **Worker** — something that takes a prompt and returns a result.
- **Task** — an event matched to a worker. The only moving object.
- **Policy** — what a result is allowed to contain.

## One Pipeline

```text
Event → Task → Worker → Result (filtered by Policy) → done
```

## Workers

A worker is any endpoint that accepts a prompt and returns a result:

- **Claude** — via Claude Agent SDK
- **Codex** — via OpenAI API
- **Gemini** — via Google AI
- **Ollama** — via local endpoint
- **Any HTTP service** — on your Tailscale network or anywhere reachable

Workers can be **managed** (Docker containers started by mecha) or **unmanaged** (services you run yourself). At dispatch time, they all look the same: an HTTP endpoint.

## Security

Workers never talk to GitHub. Mecha is the only thing that writes:

```text
Worker → mecha → Policy → GitHub
```

All writes go through Policy. One security boundary. One audit trail.
