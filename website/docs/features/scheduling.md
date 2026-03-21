---
title: Scheduling
description: Built-in cron-like scheduler for running agent tasks on a recurring basis.
---

# Scheduling

[[toc]]

Mecha includes a built-in scheduler for running agent tasks on a recurring basis — cron-like automation without leaving the Mecha ecosystem.

## Adding a Schedule

```bash
# Run every hour
mecha schedule add researcher --id check-papers --every 1h --prompt "Check for new papers"

# Run every 30 minutes
mecha schedule add coder --id run-tests --every 30m --prompt "Run the test suite"
```

The `--every` accepts human-readable intervals (`30s`, `5m`, `1h`). The `--prompt` is sent to the agent on each run. The `--id` is a unique identifier for the schedule.

## Managing Schedules

```bash
# List all schedules for a bot
mecha schedule list <bot>

# Pause a schedule on a bot
mecha schedule pause <bot> <schedule-id>

# Pause all schedules on a bot
mecha schedule pause <bot>

# Resume a paused schedule
mecha schedule resume <bot> <schedule-id>

# Run immediately (outside schedule)
mecha schedule run <bot> <schedule-id>

# Remove a schedule
mecha schedule remove <bot> <schedule-id>
```

## Run History

```bash
# View past runs
mecha schedule history <bot> <schedule-id>
```

Shows timestamps, outcomes (success/failure), and response summaries for each execution.

## How It Works

The scheduler runs inside the bot runtime. When a schedule triggers:

1. The scheduler sends the configured message as a chat query
2. The agent processes the query using its workspace and tools
3. The result is recorded in the schedule history
4. The next run is scheduled based on the interval

Schedules persist across bot restarts -- they are stored in the bot's configuration and state files on disk.

### Safety Mechanisms

The scheduler includes several safeguards to prevent runaway execution:

- **Daily budget** -- A configurable `maxRunsPerDay` limit (default: 50) is enforced across all schedules for the bot. Runs that exceed the budget are recorded with outcome `"skipped"`.
- **Concurrency guard** -- Only one schedule can execute at a time per bot. If a run is attempted while another is active, it is skipped.
- **Auto-pause on consecutive errors** -- After 5 consecutive failures, the schedule is automatically paused to prevent repeated failures.
- **Chained setTimeout** -- The scheduler uses chained `setTimeout` calls (not `setInterval`) to prevent overlapping runs when a single execution takes longer than the interval.
- **Today counter reset** -- The `runsToday` counter automatically resets when the date changes (compared via ISO date string).

## API Reference

See [@mecha/core API Reference](/reference/api/core#scheduling) for the schedule types.
