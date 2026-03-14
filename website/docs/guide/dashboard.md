# Dashboard

Mecha includes two dashboard levels: a **fleet dashboard** for managing all bots, and a **bot dashboard** inside each container.

## Fleet Dashboard

```bash
mecha dashboard
# Opens http://localhost:7700
```

The fleet dashboard shows:
- All running bots with status indicators
- Cost tracking per bot
- Quick links to individual bot dashboards
- Bot controls (start, stop, restart)

The dashboard uses a local browser session on `localhost` so the SPA and proxied bot dashboards work without manually copying bearer tokens.

## Bot Dashboard

Each bot container serves its own dashboard. Access it through the fleet dashboard by clicking on a bot, or directly if the bot has an exposed port.

Bot dashboard views:
- **Chat** — send prompts and see responses
- **Sessions** — browse conversation history
- **Schedule** — view and manage cron jobs
- **Webhooks** — see incoming webhook events
- **Logs** — real-time container logs
- **Config** — view and edit bot configuration
