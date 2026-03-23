# 11 - Failure & Recovery

Tests for error handling, crash recovery, and graceful degradation.

## Prerequisites

- Mecha daemon running with bots spawned

## Tests

### Process Crashes

| # | Test | Steps | Expected | P | Result |
|---|------|-------|----------|---|--------|
| 11.1 | Bot process crash | `kill -9 <bot-pid>` | State updated to "error", `mecha bot ls` reflects crash | P0 | |
| 11.2 | Start after crash | `mecha bot start <crashed-bot>` | Bot restarts from persisted config | P0 | |
| 11.3 | Daemon process crash | `kill -9 <daemon-pid>` | Bots continue running independently | P0 | |
| 11.4 | Daemon restart | `mecha start -d --host 0.0.0.0` after daemon crash | Daemon starts, rediscovers running bots | P0 | |
| 11.5 | Meter crash recovery | `kill -9 <meter-pid>`, then `mecha meter start` | Meter restarts, loads snapshot | P1 | |

### Port Conflicts

| # | Test | Steps | Expected | P | Result |
|---|------|-------|----------|---|--------|
| 11.6 | Port in use | Block port 7700 externally, `mecha bot spawn test ~/project` | Allocates next available port (7701+) | P0 | |
| 11.7 | All ports exhausted | Block all 7700-7799 | Clear error message, spawn fails | P1 | |

### Filesystem Errors

| # | Test | Steps | Expected | P | Result |
|---|------|-------|----------|---|--------|
| 11.8 | Corrupt config.json | Write invalid JSON to `~/.mecha/<bot>/config.json` | Graceful error on bot start, not crash | P0 | |
| 11.9 | Missing state.json | Delete `~/.mecha/<bot>/state.json` | Bot treated as stopped, not crash | P0 | |
| 11.10 | Read-only filesystem | `chmod 000 ~/.mecha/<bot>/` | Spawn fails with permission error | P1 | |

### Network Errors

| # | Test | Steps | Expected | P | Result |
|---|------|-------|----------|---|--------|
| 11.11 | Chat timeout | Set very short timeout, send complex query | Timeout error returned (not hang) | P0 | |
| 11.12 | Remote node unreachable | Register node, take it offline, `mecha node ping` | Timeout with clear error | P0 | |
| 11.13 | API key expired | Use expired API key, chat with bot | SDK error returned (not crash) | P0 | |
| 11.14 | Invalid API key | Set garbage key, chat | Clear error: "invalid API key" | P0 | |

### Concurrent Operations

| # | Test | Steps | Expected | P | Result |
|---|------|-------|----------|---|--------|
| 11.15 | Simultaneous spawn | Run 5 `mecha bot spawn` in parallel | All succeed with unique ports | P1 | |
| 11.16 | Stop during chat | Start long chat, then `mecha bot stop` mid-response | Bot stops gracefully, no zombie process | P1 | |

## Recovery Verification

```bash
# After any failure test, verify system recovers:
mecha status              # Daemon healthy
mecha bot ls              # Bots listed correctly
mecha meter status        # Meter running
curl .../healthz          # Agent responds

# Check for zombie/orphan processes
ps aux | grep mecha
```
