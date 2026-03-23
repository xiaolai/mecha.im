# 011 - CLI Commands Blocked by Daemon Lock

## Category
07 - Metering & Budgets (also affects all CLI commands)

## Affected Tests
7.9, 7.11 (when daemon is running)

## Severity
Medium - CLI unusable while daemon runs

## Description

When the mecha daemon is running (`mecha start --daemon`), most CLI commands fail with "Another mecha CLI is already running (pid XXXX)". This blocks:
- `mecha budget set/rm/ls`
- `mecha cost`
- `mecha meter start/stop/status`
- `mecha mcp serve`

The daemon holds a process-level lock that prevents any other mecha CLI instance from running.

## Steps to Reproduce

1. Start daemon: `MECHA_DIR=$PWD mecha start --host 0.0.0.0 --daemon`
2. Try: `mecha budget set coder --daily 5.00`
3. Error: "Another mecha CLI is already running (pid 772300)"

## Workaround

Kill the daemon, run the CLI command, restart the daemon. This is impractical for production use.

## Expected Behavior

Budget/cost/meter CLI commands should either:
- Communicate with the running daemon via API instead of acquiring the lock
- Use a read-only lock mode for non-destructive operations
- Route through the agent server API (port 7660)

## Impact

- Cannot manage budgets, view costs, or control the meter while the daemon is running
- Forces users to stop/restart the daemon for administrative tasks
