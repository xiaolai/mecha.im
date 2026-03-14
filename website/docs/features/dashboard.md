# Dashboard

Mecha ships with two dashboard tiers: a fleet-level overview and per-bot dashboards.

## Fleet Dashboard

```bash
mecha dashboard
# Opens http://localhost:7700
```

The fleet dashboard provides:

- **Bot list** — all bots with real-time status (running, stopped, error)
- **Cost tracking** — per-bot spending
- **Controls** — start, stop, restart bots
- **Navigation** — click a bot to open its individual dashboard

## Bot Dashboard

Each container runs its own dashboard, accessible through the fleet dashboard or directly via exposed ports.

### Views

| Tab | Purpose |
|-----|---------|
| **Chat** | Send prompts and see responses |
| **Sessions** | Browse conversation history with session details |
| **Schedule** | View, add, edit, and delete cron entries |
| **Webhooks** | Monitor incoming webhook events |
| **Logs** | Real-time container log stream |
| **Settings** | View and modify bot configuration |

### Session Management

The Sessions tab shows all past conversations with:
- Duration and cost per session
- Full message history
- Session resume capability

### Schedule Management

Full CRUD for cron schedules from the dashboard — add new entries, edit cron expressions and prompts, delete schedules, and see next-run times.

## Authentication

The fleet dashboard handles authentication automatically using a local browser session. No need to manually copy bearer tokens.
