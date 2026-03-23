# 033 - Force Stop During Active Chat Fails

**Test:** 11.16 - Stop during chat (graceful stop, no zombie)
**Machine:** spark01 (100.100.1.5)
**Severity:** P1

## Observed

1. `mecha bot stop par-1` correctly refuses when a session is active: `bot "par-1" has 1 active session — use --force to override`. Good.
2. `mecha bot stop par-1 --force` returns `bot "par-1" not found`. The bot is NOT stopped.
3. The chat process and bot process continue running.
4. `mecha bot kill par-1` works and cleanly terminates everything (no zombies).

## Expected

`--force` should override the active session check and stop the bot gracefully (SIGTERM, then SIGKILL after timeout).

## Impact

Users cannot gracefully stop a bot that has an active session via the stop command. They must use `kill`, which is not graceful.

## Notes

The `--force` flag on `stop` appears to route through a different code path that fails to find the bot in the daemon registry. The `kill` command works because it sends signals directly.
