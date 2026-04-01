---
description: Mecha domain model — four nouns, their verbs, and the pipeline
globs: "**/*.go"
---

# Domain Model

Mecha has exactly four nouns: Event, Worker, Task, Policy.

## Pipeline

```
Event.arrive → Event.match → Task.create → Task.dispatch → Policy.filter → Respond
```

## Event Model (Universal)

Events are provider-neutral. All provider-specific data lives in `Attrs`.

| Field | Purpose | Example |
|---|---|---|
| `Source` | Provider name | `github`, `slack`, `telegram`, `cron` |
| `Type` | Event type | `pull_request.opened`, `message`, `tick` |
| `Actor` | Who triggered | username, phone, bot name |
| `Subject` | What it's about | `owner/repo`, `#channel`, `schedule-daily` |
| `Attrs` | Provider-specific fields | `repo_owner`, `number`, `diff`, `text` |
| `DedupKey` | Semantic dedup (enforced) | Content hash for polls/cron — active events block duplicates |

## Provider Interfaces

| Interface | Direction | Purpose |
|---|---|---|
| `Source` | Inbound (passive) | Parse webhooks into Events |
| `Trigger` | Inbound (active) | Generate events (cron, polling) |
| `Hydrator` | Enrichment | Fetch additional data via API |
| `Verifier` | Handshake | Challenge-response verification |
| `Authenticated` | Inbound (marker) | Sources that self-validate (HMAC) skip server-level API key auth |
| `Responder` | Outbound | Write results back to platform |

## Nouns and Verbs

- **Event**: arrive, match, hydrate, skip, fail
- **Worker**: add, remove, start, stop, ls
- **Task**: create, dispatch, complete, fail, retry
- **Policy**: filter

## Rules

- Each verb belongs to exactly one noun. No orphan verbs.
- Each verb changes exactly one noun.
- Nouns don't know each other. Connected only through the pipeline.
- One noun, one lifecycle.
- No hidden nouns. Unowned logic means a missing noun.
- Verbs are idempotent where possible.
- Responder is keyed by `ev.Source`. Target-based routing is planned but not yet implemented.
