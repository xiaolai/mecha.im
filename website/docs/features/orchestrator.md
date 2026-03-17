# Orchestrator Bot

An orchestrator is a bot with `fleet_control` permission that can programmatically manage the fleet — spawning, stopping, restarting, and monitoring other bots.

## Setup

Create a bot config with `permissions.fleet_control: true`:

```yaml
name: orchestrator
system: |
  You are the fleet orchestrator. You manage bot lifecycle,
  monitor costs, and enforce policies. You can spawn, stop,
  and configure other bots.
model: sonnet
permissions:
  fleet_control: true
max_budget_usd: 1.00
```

```bash
# Start the daemon first (required for fleet_control bots)
mecha daemon start --background

# Then spawn the orchestrator
mecha spawn orchestrator.yaml
```

::: warning
The daemon must be running before spawning a `fleet_control` bot. The bot receives the daemon's URL at spawn time.
:::

## Fleet MCP Tools

When `fleet_control` is enabled, the bot gets 9 additional MCP tools:

| Tool | Description |
|------|-------------|
| `mecha_fleet_ls` | List all bots with status |
| `mecha_fleet_spawn` | Spawn a new bot (name, system, model, auth) |
| `mecha_fleet_stop` | Stop a bot |
| `mecha_fleet_start` | Start a stopped bot |
| `mecha_fleet_restart` | Restart a bot |
| `mecha_fleet_rm` | Remove a bot |
| `mecha_fleet_costs` | Get cost breakdown |
| `mecha_fleet_config` | View a bot's config (read-only) |
| `mecha_fleet_status` | Fleet health summary |

These tools proxy to the daemon's internal fleet API using `MECHA_FLEET_INTERNAL_SECRET`.

## Security Guards

- **Self-protection**: Cannot stop, restart, or remove itself
- **Rate limits**: Max 5 spawns/hour, max 20 fleet operations/hour
- **Read-only config**: Fleet tools cannot edit bot configs (prevents silent reconfiguration via prompt injection)
- **Audit trail**: Every fleet operation is logged to the daemon's audit log

## How Regular Bots Use the Orchestrator

Regular bots (without `fleet_control`) can request fleet actions through the orchestrator using `mecha_call`:

```
Bot "reviewer": mecha_call("orchestrator", "spawn a bot named data-analyst with system prompt 'You analyze data trends' using model sonnet")
```

The orchestrator interprets the request, validates it against policies, and executes using fleet tools. This provides a natural language permission layer.

## Example: Auto-Scaling Workers

```yaml
name: orchestrator
system: |
  You manage a fleet of worker bots. When asked to scale up,
  spawn new workers. When asked to scale down, stop idle workers.
  Monitor costs and never exceed $10/day across the fleet.

  Available worker template:
  - name: worker-N (where N is a number)
  - system: "You process data analysis tasks"
  - model: sonnet

  Current policy:
  - Max 5 workers at a time
  - Stop idle workers after 30 minutes
  - Alert if daily cost exceeds $8
permissions:
  fleet_control: true
```
