---
title: Message Bus
description: Asynchronous pub/sub messaging and durable work queues for inter-bot coordination
---

# Message Bus

The message bus provides asynchronous pub/sub messaging and durable work queues for inter-bot coordination. Instead of synchronous `mesh_query` (where bot A blocks waiting for bot B), bots publish events to topics and claim work from queues.

## Core Concepts

### Topics (Pub/Sub)

A topic is a named channel. Any bot publishes a message; all subscribers receive it independently.

```
Bot A publishes → topic "pr-opened" → Bot B receives, Bot C receives
```

Each subscriber tracks its own cursor — messages are not lost if a subscriber is temporarily offline.

### Queues (Competing Consumers)

A queue distributes work items to the first available consumer. Only one bot processes each message.

```
Work item → queue "review-queue" → first idle bot claims it
```

Failed items retry automatically (configurable max retries). After exhausting retries, items move to a dead-letter queue for inspection.

## Data Model

All bus data is stored as JSONL files under `~/.mecha/bus/`:

```
~/.mecha/bus/
├── topics/
│   └── pr-opened/
│       ├── messages.jsonl       # append-only message log
│       └── subscribers.json     # per-subscriber cursor positions
├── queues/
│   └── review-queue/
│       ├── pending.jsonl        # unclaimed messages
│       ├── inflight.jsonl       # claimed, not yet acknowledged
│       └── dead.jsonl           # failed after max retries
└── bus.json                     # topic/queue definitions
```

## Key Features

- **Idempotency**: Every message has a unique ID. Duplicates are rejected within a retention window.
- **At-least-once delivery**: Subscriber cursors ensure messages redeliver if a bot crashes mid-processing.
- **Backpressure**: Each subscriber has a configurable concurrency limit (default: 1).
- **Dead-letter queue**: Failed messages are preserved for inspection, not silently dropped.
- **Persistence**: All state survives daemon restarts — messages are JSONL files, not in-memory.

## CLI Usage

### Topics

```bash
# Create a topic
mecha bus topic create pr-events
# Topic "pr-events" created

# Publish a message
mecha bus topic publish pr-events '{"repo":"acme","pr":42}'
# Published message 4bdd4644-... to topic "pr-events"

# List topics
mecha bus topic list
# Name
# ------------
# pr-events
# deploy-ready

# View recent messages
mecha bus topic tail pr-events -n 5
# ID                                    Timestamp                 Sender  Payload
# ------------------------------------  ------------------------  ------  -----------------------
# 4bdd4644-3144-4b09-b446-c95ef04451f4  2026-03-21T09:22:36.737Z  cli     {"repo":"acme","pr":42}
```

### Queues

```bash
# Create a queue
mecha bus queue create review-queue --max-retries 5
# Queue "review-queue" created (maxRetries: 5)

# Inspect queue
mecha bus queue inspect review-queue
# Metric    Count
# --------  -----
# pending   0
# inflight  0
# dead      0

# Drain (move all pending to dead letter)
mecha bus queue drain review-queue
```

### MCP Tools (available to bots)

Bots can access the bus via MCP tools: `bus_publish`, `bus_queue_push`, `bus_queue_claim`, `bus_queue_ack`.

## Package

`@mecha/bus` — `packages/bus/src/`

| Export | Description |
|--------|-------------|
| `createBroker(busDir)` | Create a broker managing queues and topics |
| `createQueue(opts)` | Create a durable queue with retry and dead-letter |
| `createTopic(opts)` | Create a pub/sub topic with per-subscriber cursors |
| `createReplicator(opts)` | Cross-node topic replicator for multi-machine setups |
