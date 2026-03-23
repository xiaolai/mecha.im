---
title: "@mecha/bus"
description: Message broker with durable queues and pub/sub topics for inter-bot communication
---

# @mecha/bus

The bus package provides a filesystem-backed message broker with durable work queues and pub/sub topics. All state persists to `~/.mecha/bus/`.

## Exports

| Symbol | Kind | Source |
|--------|------|--------|
| `createBroker` | Function | `broker.ts` |
| `Broker` | Interface | `broker.ts` |
| `createQueue` | Function | `queue.ts` |
| `DurableQueue` | Interface | `queue.ts` |
| `CreateQueueOpts` | Interface | `queue.ts` |
| `createTopic` | Function | `topic.ts` |
| `Topic` | Interface | `topic.ts` |
| `CreateTopicOpts` | Interface | `topic.ts` |
| `createReplicator` | Function | `replicator.ts` |
| `Replicator` | Interface | `replicator.ts` |
| `ReplicatorOpts` | Interface | `replicator.ts` |
| `ReplicationResult` | Interface | `replicator.ts` |
| `BusMessage` | Interface | `types.ts` |
| `QueueConfig` | Interface | `types.ts` |
| `ClaimedItem` | Interface | `types.ts` |
| `Subscriber` | Interface | `types.ts` |
| `TopicConfig` | Interface | `types.ts` |
| `BusConfig` | Interface | `types.ts` |

## `createBroker(busDir)`

```ts
function createBroker(busDir: string): Broker
```

Create a message broker backed by a directory. Manages queues and topics with config persisted to `bus.json`.

```ts
import { createBroker } from "@mecha/bus";

const broker = createBroker("/home/user/.mecha/bus");
```

### `Broker` interface

| Method | Returns | Description |
|--------|---------|-------------|
| `queue(name, config?)` | `DurableQueue` | Create or get a durable queue |
| `topic(name, config?)` | `Topic` | Create or get a pub/sub topic |
| `queueNames()` | `string[]` | List all queue names |
| `topicNames()` | `string[]` | List all topic names |
| `busDir` | `string` | The bus directory path |

## Queues

### `createQueue(opts)`

```ts
function createQueue(opts: CreateQueueOpts): DurableQueue
```

Create a durable competing-consumer queue. Messages are persisted to JSONL files.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `dir` | `string` | — | Queue data directory |
| `name` | `string` | — | Queue name |
| `maxRetries` | `number` | `3` | Max retry attempts before dead-letter |
| `retryBackoffMs` | `number` | `5000` | Backoff between retries (ms) |

### `DurableQueue` interface

| Method | Returns | Description |
|--------|---------|-------------|
| `push(msg)` | `string` | Push a message, returns message ID |
| `claim()` | `ClaimedItem \| null` | Claim next pending message |
| `ack(id)` | `void` | Acknowledge (complete) a claimed message |
| `nack(id)` | `void` | Negative-ack — return to pending or dead-letter |
| `inspect()` | `{ pending, inflight, dead }` | Count messages by state |
| `drain()` | `number` | Move all pending to dead-letter, returns count |

## Topics

### `createTopic(opts)`

```ts
function createTopic(opts: CreateTopicOpts): Topic
```

Create a pub/sub topic. Messages are appended to a JSONL file. Subscribers track their cursor position.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `dir` | `string` | — | Topic data directory |
| `name` | `string` | — | Topic name |
| `retentionDays` | `number` | `7` | Message retention period |

### `Topic` interface

| Method | Returns | Description |
|--------|---------|-------------|
| `publish(msg)` | `string` | Publish a message, returns ID |
| `subscribe(name)` | `void` | Register a subscriber |
| `poll(subscriber, limit?)` | `BusMessage[]` | Read unread messages for a subscriber |
| `tail(limit?)` | `BusMessage[]` | Read most recent messages |
| `messageCount()` | `number` | Total messages in topic |
| `subscribers()` | `Subscriber[]` | List all subscribers with cursor positions |

## Replication

### `createReplicator(opts)`

```ts
function createReplicator(opts: ReplicatorOpts): Replicator
```

Create a cross-node replicator that forwards messages to remote bus instances.

### `Replicator` interface

| Method | Returns | Description |
|--------|---------|-------------|
| `replicate(topic, messages)` | `ReplicationResult` | Forward messages to registered nodes |

## Types

### `BusMessage`

```ts
interface BusMessage {
  id: string;
  ts: string;
  sender: string;
  payload: unknown;
}
```

### `ClaimedItem`

```ts
interface ClaimedItem {
  id: string;
  message: BusMessage;
  attempt: number;
  claimedAt: string;
}
```

## See Also

- [Message Bus Feature](/features/bus) — user guide with examples
- [Orchestration CLI](/reference/cli/orchestration#bus) — CLI commands
