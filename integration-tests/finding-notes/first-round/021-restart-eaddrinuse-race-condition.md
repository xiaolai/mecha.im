# 021 - Restart EADDRINUSE Race Condition

**Tests:** 1.18 (restart stopped bot), 1.19 (restart-all)
**Severity:** High
**Status:** Bug

## Summary

`mecha bot restart` and `mecha bot restart-all` fail with EADDRINUSE because the new bot process attempts to bind the port before the old process has fully released it.

## Reproduction

```bash
# Spawn and stop a bot
mecha bot spawn tagged ~/mecha-camp/coder --tags dev,research
mecha bot stop tagged

# Restart immediately
mecha bot restart tagged
# Output: "Restarted tagged on port 7703"

# But bot is actually stopped:
mecha bot status tagged
# state: stopped, startedAt and stoppedAt ~160ms apart

# stderr.log shows:
# error: Failed to start server. Is port 7703 in use?
#  code: "EADDRINUSE"
```

For `restart-all`, every bot crashes because all ports are still held by old processes:
```bash
mecha bot restart-all
# "Restarted 5, skipped 0, failed 0" — reports success
mecha bot ls
# All 5 bots show state: stopped
```

## Root Cause

The restart command stops the old process and immediately spawns a new one without:
1. Waiting for the old process to fully exit and release the socket
2. Verifying the port is available before spawning
3. Using SO_REUSEADDR/SO_REUSEPORT on the server socket

The old bot process (Bun runtime) sometimes survives the stop signal and continues holding the port, creating orphan processes visible via `ss -tlnp`.

## Impact

- `restart` and `restart-all` are effectively broken - they report success but all bots crash
- Orphan bot processes accumulate, holding ports indefinitely
- State.json becomes inconsistent (shows "stopped" while process is alive on port)

## Expected Fix

- Wait for old process to exit and port to be free before spawning the replacement
- Add a port availability check with retry/backoff before bind
- Consider SO_REUSEPORT on the Bun server
- `restart-all` should serialize restarts or at minimum verify each bot is healthy after restart
