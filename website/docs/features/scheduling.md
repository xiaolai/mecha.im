# Scheduling

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
# List all schedules for a CASA
mecha schedule list <casa>

# Pause a schedule on a CASA
mecha schedule pause <casa> <schedule-id>

# Pause all schedules on a CASA
mecha schedule pause <casa>

# Resume a paused schedule
mecha schedule resume <casa> <schedule-id>

# Run immediately (outside schedule)
mecha schedule run <casa> <schedule-id>

# Remove a schedule
mecha schedule remove <casa> <schedule-id>
```

## Run History

```bash
# View past runs
mecha schedule history <casa> <schedule-id>
```

Shows timestamps, outcomes (success/failure), and response summaries for each execution.

## How It Works

The scheduler runs inside the CASA runtime. When a schedule triggers:

1. The scheduler sends the configured message as a chat query
2. The agent processes the query using its workspace and tools
3. The result is recorded in the schedule history
4. The next run is scheduled based on the interval

Schedules persist across CASA restarts — they're stored in the CASA's configuration.
