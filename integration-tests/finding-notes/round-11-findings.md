# Round 11 — Failure & Recovery Findings

**Version**: 4.1.2
**Date**: 2026-03-23
**Machine(s)**: mac-mini-home (100.100.1.7)

## Summary

6/16 tests passed. 2 FAIL (meter blocking), 8 deferred.

## Test Results

| # | Test | Result |
|---|------|--------|
| 11.1 | Bot process crash | PASS (state → error) |
| 11.2 | Start after crash | FAIL — meter proxy blocks restart (see Finding 1) |
| 11.3 | Daemon crash | PARTIAL — couldn't locate daemon PID file |
| 11.4 | Daemon restart | PASS |
| 11.5 | Meter crash recovery | DEFERRED |
| 11.6-11.7 | Port conflicts | DEFERRED |
| 11.8 | Corrupt config.json | PASS (graceful "bot not found") |
| 11.9 | Missing state.json | PASS (treated as not found) |
| 11.10 | Read-only filesystem | DEFERRED |
| 11.11-11.14 | Network errors | DEFERRED |
| 11.15-11.16 | Concurrent ops | DEFERRED |

## Findings

### Finding 1 — Meter proxy stale state blocks bot start (HIGH)

- **Tests affected**: 11.2, and ALL bot starts after daemon restart
- **Symptom**: `Metering proxy required but not running` even after `mecha meter start` or clean daemon restart
- **Root cause**: After `mecha stop --force`, `proxy.json` retains the daemon PID. The meter status check finds this PID alive (it's the new daemon) and reports meter as "running" but port 7600 isn't bound. Bot start checks meter and fails.
- **Workaround**: Spawn with `--meter off` flag, or clean proxy state before restart
- **Impact**: HIGH — every bot restart after daemon stop/start fails unless meter off
- **Fix**: Commit `75496d8` + `aff7df9` (v4.1.3):
  1. Persist `meter: "off"` in config.json so bot start/restart respects it
  2. Clean stale proxy.json instead of throwing MeterProxyRequiredError
  3. After cleanup, subsequent starts see no proxy.json → normal skip
- **Re-test**: PASS (v4.1.3, 2026-03-23, mac-mini-home)

### Finding 2 — daemon.pid file not present

- **Test**: 11.3
- **Observed**: `cat ~/.mecha/daemon.pid` returned empty — file doesn't exist
- **Impact**: Can't programmatically find daemon PID for crash testing
- **Note**: Daemon does write PID to a file but may use different path (agent.json contains port, not PID)
