# 14 - Message Bus

End-to-end tests for the pub/sub message bus and durable queues.

## Prerequisites

- mecha v0.2.17+ installed on at least one machine
- Daemon running: `mecha start -d --host 0.0.0.0`

## Topic Tests

| # | Test | Steps | Expected | P | Result |
|---|------|-------|----------|---|--------|
| 14.1 | Create topic | `mecha bus topic create pr-events` | Topic created, appears in `bus topic list` | P0 | PASS 2026-03-24 macbook-pro |
| 14.2 | List topics | `mecha bus topic list` after creating 2+ topics | Shows all topics (name column only, no message counts) | P0 | PASS 2026-03-24 macbook-pro |
| 14.3 | Publish to topic | `mecha bus topic publish pr-events '{"repo":"acme","pr":42}'` | Message published, message count increments | P0 | PASS 2026-03-24 macbook-pro |
| 14.4 | Tail topic | `mecha bus topic tail pr-events` | Shows recent messages in chronological order | P0 | PASS 2026-03-24 macbook-pro |
| 14.5 | Tail with limit | `mecha bus topic tail pr-events -n 5` | Shows at most 5 messages | P0 | PASS 2026-03-24 macbook-pro |
| 14.6 | Publish idempotency | Publish same message ID twice | Second publish is silent (deduplicated) | P1 | DEFERRED — no --id flag on publish CLI |

## Queue Tests

| # | Test | Steps | Expected | P | Result |
|---|------|-------|----------|---|--------|
| 14.7 | Create queue | `mecha bus queue create review-queue` | Queue created | P0 | PASS 2026-03-24 macbook-pro |
| 14.8 | Create with retries | `mecha bus queue create urgent --max-retries 5` | Queue with custom retry limit | P0 | PASS 2026-03-24 macbook-pro |
| 14.9 | List queues | `mecha bus queue list` | Shows all queues | P0 | PASS 2026-03-24 macbook-pro |
| 14.10 | Inspect empty queue | `mecha bus queue inspect review-queue` | Shows 0 pending, 0 inflight, 0 dead | P0 | PASS 2026-03-24 macbook-pro |
| 14.11 | Drain queue | `mecha bus queue drain review-queue` after publishing 3 items | All items moved to dead letter, drain count = 3 | P0 | PASS 2026-03-24 macbook-pro |

## Persistence

| # | Test | Steps | Expected | P | Result |
|---|------|-------|----------|---|--------|
| 14.12 | Topics survive restart | Create topic, publish, restart daemon, `bus topic tail` | Messages still visible | P0 | PASS 2026-03-24 macbook-pro |
| 14.13 | Queues survive restart | Create queue, push item, restart daemon, `bus queue inspect` | Pending count preserved | P0 | PASS 2026-03-24 macbook-pro |

## Data Integrity

| # | Test | Steps | Expected | P | Result |
|---|------|-------|----------|---|--------|
| 14.14 | JSONL files inspectable | `cat ~/.mecha/bus/topics/pr-events/messages.jsonl` | Valid JSONL, each line is a JSON object with id/ts/sender/payload | P1 | PASS 2026-03-24 macbook-pro |
| 14.15 | bus.json config | `cat ~/.mecha/bus/bus.json` | Contains topic/queue definitions | P1 | PASS 2026-03-24 macbook-pro |

## Queue Advanced (v4.1.9)

| # | Test | Steps | Expected | P | Result |
|---|------|-------|----------|---|--------|
| 14.16 | Queue push CLI | `mecha bus queue create test-nack-q && mecha bus queue push test-nack-q "work"` | Message pushed, returns message ID | P0 | PASS 2026-03-24 macbook-pro |
| 14.17 | Queue nack CLI | Push to queue, claim message, then `mecha bus queue nack test-nack-q <msgId>` | Message returned to pending (or dead-letter if past maxRetries) | P0 | PASS 2026-03-24 macbook-pro |
| 14.18 | Dead-letters CLI | After nacking past maxRetries: `mecha bus queue dead-letters test-nack-q` | Shows dead-letter messages in table | P0 | PASS 2026-03-24 macbook-pro |
| 14.19 | Bus poll MCP tool | Spawn bot, subscribe to topic, publish message, bot uses bus_poll to read | Bot receives published message | P1 | DEFERRED — requires running bot |
