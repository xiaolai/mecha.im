# Scheduling

Bots can run prompts on cron schedules with built-in safety rails.

## Configuration

Add a `schedule` array to your bot config:

```yaml
name: monitor
system: "You monitor production systems and report anomalies."
schedule:
  - cron: "*/30 * * * *"
    prompt: "Check for new alerts in the monitoring dashboard."
  - cron: "0 9 * * 1"
    prompt: "Generate a weekly incident summary."
```

Each entry requires:
- `cron` — a standard 5-field cron expression
- `prompt` — the message sent to the bot on each trigger

## Safety Rails

| Guard | Value |
|-------|-------|
| Max runs per day | 50 |
| Timeout per run | 10 minutes |
| Auto-pause after consecutive errors | 5 |
| Skip if busy | Yes — if a previous run is still active, the new trigger is skipped |

These limits prevent runaway costs and infinite loops.

## Managing Schedules from CLI

Manage schedules directly from the command line:

```bash
# List all schedules for a bot
mecha schedule monitor ls

# Add a new schedule
mecha schedule monitor add "*/15 * * * *" "Check for new tickets"

# Pause / resume / trigger a schedule
mecha schedule monitor pause <schedule-id>
mecha schedule monitor resume <schedule-id>
mecha schedule monitor run <schedule-id>    # trigger immediately

# Remove a schedule
mecha schedule monitor rm <schedule-id>
```

Use `--json` on `ls` for machine-readable output.

You can also manage schedules from the bot dashboard's **Schedule** tab.

## Examples

```yaml
# Every 15 minutes during business hours
- cron: "*/15 9-17 * * 1-5"
  prompt: "Check for new support tickets."

# Daily at midnight
- cron: "0 0 * * *"
  prompt: "Run nightly security audit."

# Every hour
- cron: "0 * * * *"
  prompt: "Summarize new commits since last check."
```
