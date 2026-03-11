# Bot Status & Cost API

Each bot container exposes its real-time status and accumulated costs. This data powers a future pixel office animation where each bot is a character whose behavior reflects its actual state.

## Endpoints

### `GET /api/status`

Real-time bot state.

```json
{
  "name": "reviewer",
  "state": "thinking",
  "model": "sonnet",
  "uptime_seconds": 54300,
  "current_task": {
    "id": "task-abc",
    "summary": "Reviewing PR #42",
    "started_at": "2026-03-11T10:28:00Z"
  },
  "talking_to": null,
  "last_active": "2026-03-11T10:28:00Z",
  "schedule": {
    "jobs": 2,
    "next_run": "2026-03-11T11:00:00Z"
  }
}
```

When calling another bot:

```json
{
  "state": "calling",
  "talking_to": "researcher",
  "current_task": {
    "id": "task-abc",
    "summary": "Reviewing PR #42"
  }
}
```

### `GET /api/costs`

Accumulated token usage and cost.

```json
{
  "task": {
    "input_tokens": 3200,
    "output_tokens": 800,
    "cost_usd": 0.012
  },
  "today": {
    "input_tokens": 45000,
    "output_tokens": 11000,
    "cost_usd": 0.21,
    "tasks_completed": 8
  },
  "lifetime": {
    "input_tokens": 284000,
    "output_tokens": 71000,
    "cost_usd": 1.32,
    "tasks_completed": 47,
    "first_started": "2026-03-01T09:00:00Z"
  }
}
```

## Activity States

| State | Meaning | Pixel office idea |
|-------|---------|-------------------|
| `idle` | Waiting for work | Sitting at desk, maybe sipping coffee |
| `thinking` | Processing a prompt | Typing, thought bubble |
| `calling` | Talking to another bot (`mecha_call`) | Walking to another desk, phone call |
| `scheduled` | Woke up from a cron trigger | Alarm clock animation |
| `webhook` | Processing an external event | Received mail, opening envelope |
| `sleeping` | Container stopped | Desk lamp off, chair empty |
| `error` | Something broke | Red exclamation, smoke from computer |

### State transitions

```
sleeping ──spawn──→ idle
idle ──prompt──→ thinking
idle ──cron──→ scheduled → thinking
idle ──webhook──→ webhook → thinking
thinking ──mecha_call──→ calling → thinking
thinking ──done──→ idle
thinking ──error──→ error → idle
idle ──stop──→ sleeping
```

## Cost Tracking

### How it works

The SDK provides `total_cost_usd` directly on every result message. No manual token counting or pricing table needed.

```typescript
for await (const msg of conversation) {
  if (msg.type === "result") {
    costThisQuery = msg.total_cost_usd;   // SDK calculates this
  }
}
```

Three accumulation buckets:

- **Task**: current active task (resets on `mecha_new_session`)
- **Today**: rolling daily total (resets at midnight UTC)
- **Lifetime**: total since first spawn (never resets)

### Persistence

Stored in `/state/costs.json`, mounted from host. Survives container restarts.

```json
{
  "lifetime": {
    "cost_usd": 1.32,
    "queries": 47,
    "first_started": "2026-03-01T09:00:00Z"
  },
  "days": {
    "2026-03-11": { "cost_usd": 0.21, "queries": 8 },
    "2026-03-10": { "cost_usd": 0.35, "queries": 12 }
  }
}
```

Daily entries older than 90 days are pruned on boot.

## Pixel Office: Data Requirements

What the pixel office renderer needs from each bot:

| Data | Source | Update frequency |
|------|--------|------------------|
| `state` | `/api/status` | Poll every 2-3s or SSE |
| `talking_to` | `/api/status` | Same |
| `current_task.summary` | `/api/status` | Same |
| `cost_usd` (today) | `/api/costs` | Poll every 30s |
| `cost_usd` (lifetime) | `/api/costs` | Poll every 30s |
| `schedule.next_run` | `/api/status` | Poll every 60s |

### SSE alternative

For smoother animation, the bot can expose a status stream:

```
GET /api/status/stream
```

```
event: state
data: {"state": "thinking", "current_task": {...}}

event: state
data: {"state": "calling", "talking_to": "researcher"}

event: state
data: {"state": "idle", "talking_to": null}

event: cost
data: {"task": {...}, "today": {...}}
```

The pixel office subscribes once per bot and gets real-time state changes. No polling needed.
