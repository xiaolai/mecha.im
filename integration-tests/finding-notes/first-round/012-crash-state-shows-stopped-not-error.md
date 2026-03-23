# 012: Bot Crash State Shows "stopped" Instead of "error"

**Test:** 11.1 - Bot process crash
**Severity:** Low
**Machine:** spark01 (100.100.1.5)

## Observed

When a bot process is killed with `kill -9`, the state.json is updated to `"state": "stopped"` instead of `"state": "error"`.

```
$ kill -9 <bot-pid>
$ mecha bot ls
Name   State    Port  PID     Tags
-----  -------  ----  ------  ----
coder  stopped  7700  702498  -
```

## Expected

State should be `"error"` (or `"crashed"`) to distinguish between a graceful stop and an unexpected crash. The spec says: "State updated to 'error', `mecha bot ls` reflects crash".

## Impact

Users cannot distinguish between a bot that was intentionally stopped vs one that crashed. No crash indicator in `bot ls` output.

## Notes

The bot does get properly detected as not running, and can be restarted with `bot start`. The functional recovery works correctly, only the state label is wrong.
