# Finding 002: Stale bot processes cause port conflicts

**Date**: 2026-03-10
**Severity**: HIGH
**Version**: v0.2.7
**Affected**: All platforms
**Category**: 01-bot-lifecycle

## Symptom

After a daemon restart or bot kill, old bot processes may continue running and holding their port. New bot spawns on the same port fail with `EADDRINUSE`, crash silently, and write `state: stopped` immediately.

Meanwhile, the OLD process still responds to requests with the OLD token — causing "Invalid token" errors when using the NEW token from config.json.

## Root Cause

When a mecha daemon restarts, it doesn't kill child bot processes. The old processes (running inside bwrap sandboxes) become orphans. State file says "stopped" but the actual process is still alive and listening on the port.

## Evidence

```
# State says stopped but port is occupied
mecha bot status coder → state: stopped
lsof -i :7700 → old PID still listening

# New bot gets EADDRINUSE
stderr: "Failed to start server. Is port 7700 in use?"
```

## Workaround

Manually kill stale processes before starting bots:
```bash
lsof -i :7700 | awk 'NR>1{print $2}' | xargs kill
```

## Fix Needed

The ProcessManager should:
1. Check if port is in use before spawning
2. If a stale process holds the port, kill it (verify PID matches last known bot PID)
3. Daemon stop should kill all child bot processes before exiting

## Status

- [x] Root cause identified
- [ ] Fix needed in process manager
