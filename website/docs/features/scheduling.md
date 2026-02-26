# Scheduling

Mecha includes a built-in scheduler for running agent tasks on a recurring basis — cron-like automation without leaving the Mecha ecosystem.

## Adding a Schedule

```bash
# Run every hour
mecha schedule add researcher --interval 3600 --message "Check for new papers"

# Run every 30 minutes
mecha schedule add coder --interval 1800 --message "Run the test suite"
```

The `--interval` is in seconds. The `--message` is the prompt sent to the agent on each run.

## Managing Schedules

```bash
# List all schedules
mecha schedule list

# Pause a schedule
mecha schedule pause <schedule-id>

# Resume a paused schedule
mecha schedule resume <schedule-id>

# Run immediately (outside schedule)
mecha schedule run <schedule-id>

# Remove a schedule
mecha schedule remove <schedule-id>
```

## Run History

```bash
# View past runs
mecha schedule history <schedule-id>
```

Shows timestamps, outcomes (success/failure), and response summaries for each execution.

## How It Works

The scheduler runs inside the CASA runtime. When a schedule triggers:

1. The scheduler sends the configured message as a chat query
2. The agent processes the query using its workspace and tools
3. The result is recorded in the schedule history
4. The next run is scheduled based on the interval

Schedules persist across CASA restarts — they're stored in the CASA's configuration.
