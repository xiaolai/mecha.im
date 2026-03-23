# Round 5 Testing Matrix — v0.2.11

**Date**: 2026-03-11
**Version**: v0.2.11
**Machines**: local (joker-mbp), linode02, spark01, mac-mini-home

## Goals

1. **Verify R4 fixes** (R4-001, R4-002, R4-003, R4-004) — all fixed in v0.2.11
2. **Close gaps** from undertested areas (sandbox, network resilience, concurrent ops)
3. **Regression sweep** on areas not retested since Round 2/3

---

## Phase 1: R4 Fix Verification (P0)

All R4 findings were fixed in v0.2.11. Must confirm each fix works on real machines.

| # | Test | Machine | Category | Verifies |
|---|------|---------|----------|----------|
| V-01 | Kill bot with SIGKILL, check `bot status` shows `error` not `stopped` | linode02 | Bot Lifecycle | R4-001 |
| V-02 | Kill bot, restart daemon — dead PID marked `error` on init, then recovered to `stopped` | spark01 | Failure Recovery | R4-001 |
| V-03 | Stop bot, `bot start` same name — no token mismatch, health check passes | mac-mini | Bot Lifecycle | R4-002 |
| V-04 | Leave stale bot process running on port, `bot start` same name — stale PID killed, new bot starts clean | linode02 | Bot Lifecycle | R4-002 |
| V-05 | Add managed node entry, cross-node query — unsigned routing requests pass auth (signature hook skips) | local→spark01 | Mesh Networking | R4-003 |
| V-06 | `mecha mcp serve` with no `--port` — starts on 7682, no conflict with daemon MCP on 7680 | mac-mini | MCP Server | R4-004 |

### V-01 Steps
```bash
# On linode02
mecha bot start test-kill --workspace /tmp
mecha bot status test-kill          # state: running, note PID
kill -9 <pid>
sleep 2
mecha bot status test-kill          # EXPECT: state: error (not stopped)
```

### V-02 Steps
```bash
# On spark01
mecha bot start test-recovery --workspace /tmp
kill -9 <pid>
mecha stop                          # stop daemon
mecha start --host 0.0.0.0 --daemon # restart daemon
mecha bot status test-recovery      # EXPECT: state: stopped (recovered from error)
```

### V-03 Steps
```bash
# On mac-mini
mecha bot start test-reuse --workspace /tmp
mecha bot stop test-reuse
mecha bot start test-reuse --workspace /tmp
# EXPECT: starts successfully, no token mismatch error
mecha bot status test-reuse         # state: running
```

### V-04 Steps
```bash
# On linode02
mecha bot start stale-test --workspace /tmp
# Note: PID and port
mecha bot stop stale-test
# Manually mark state as stopped but leave process running:
# (Or just: kill the daemon, modify state.json, restart daemon)
mecha bot start stale-test --workspace /tmp
# EXPECT: stale process killed automatically, new bot starts clean
```

### V-05 Steps
```bash
# On local machine, query a bot on spark01 via mesh
curl -s -X POST http://localhost:7660/api/bots/coder/query \
  -H "Authorization: Bearer <token>" \
  -H "X-Mecha-Source: local-bot" \
  -H "Content-Type: application/json" \
  -d '{"message":"hello","node":"spark01"}'
# EXPECT: 200 OK (not 401 signature error)
```

### V-06 Steps
```bash
# On mac-mini
mecha mcp serve --transport http
# EXPECT: listening on port 7682
# Confirm daemon MCP on 7680 is not affected
curl http://localhost:7680/health     # daemon MCP still works
curl http://localhost:7682/health     # standalone MCP works
```

---

## Phase 2: Undertested Areas (P1)

### 2a. Sandbox (not tested since R1)

| # | Test | Machine | Notes |
|---|------|---------|-------|
| S-01 | `bot start --sandbox require` on macOS — Seatbelt profile applied | mac-mini | Check `sandbox-profile.json` in bot dir |
| S-02 | `bot start --sandbox off` — no sandbox wrapping | linode02 | Verify no sandbox-profile.json |
| S-03 | `bot start --sandbox auto` — auto-detection (Seatbelt on macOS, skip on Linux) | local + linode02 | Cross-platform behavior |
| S-04 | `bot start --sandbox require` on Linux without Bubblewrap — expect error | linode02 | Should fail with descriptive message |
| S-05 | `--dangerously-skip-permissions` without `--sandbox require` — rejected | local | Validation constraint |

#### S-01 Steps
```bash
# On mac-mini
mecha bot start sandbox-test --workspace /tmp --sandbox require
mecha bot status sandbox-test       # EXPECT: sandboxMode: require
ls ~/.mecha/bots/sandbox-test/sandbox-profile.json  # EXPECT: exists
cat ~/.mecha/bots/sandbox-test/sandbox-profile.json  # EXPECT: platform: "seatbelt"
```

#### S-04 Steps
```bash
# On linode02 (no Bubblewrap installed)
mecha bot start sandbox-fail --workspace /tmp --sandbox require
# EXPECT: Error "Sandbox required but ..."
```

#### S-05 Steps
```bash
# On local
mecha bot start unsafe-test --workspace /tmp --dangerously-skip-permissions
# EXPECT: Error — requires --sandbox require
mecha bot start unsafe-test --workspace /tmp --dangerously-skip-permissions --sandbox require
# EXPECT: Success (sandboxed + permissions skipped)
```

### 2b. Network Resilience (never tested)

| # | Test | Machine | Notes |
|---|------|---------|-------|
| N-01 | Cross-node query while remote daemon is stopped | local→linode02 | Expect timeout/connection refused error |
| N-02 | Remote node offline then back — mesh recovers | spark01→linode02 | Stop/restart linode02 daemon, retry |
| N-03 | `mecha node ping <node>` when unreachable | local | Expect clean error, no hang |
| N-04 | Cross-node bot list with one node down | local | 3-node mesh, one offline |

#### N-01 Steps
```bash
# Stop linode02 daemon
ssh joker@100.100.1.9 'mecha stop'

# From local, try cross-node query
curl -s -X POST http://localhost:7660/api/bots/alice/query \
  -H "Authorization: Bearer <token>" \
  -H "X-Mecha-Source: test" \
  -H "Content-Type: application/json" \
  -d '{"message":"ping","node":"linode02"}'
# EXPECT: error response (timeout or connection refused), not hang

# Restart linode02
ssh joker@100.100.1.9 'mecha start --host 0.0.0.0 --daemon'
```

#### N-03 Steps
```bash
# On local — ping a node that's down
mecha node ping linode02
# EXPECT: error with "unreachable" or "timeout", completes within ~5s
```

#### N-04 Steps
```bash
# Stop spark01 daemon
ssh joker@100.100.1.5 'mecha stop'

# From local — list bots across mesh
curl http://localhost:7660/api/nodes
# EXPECT: shows all 3 nodes, spark01 may show as unreachable
# Bot list from linode02 should still work
curl "http://localhost:7660/api/bots?node=linode02" \
  -H "Authorization: Bearer <token>"
# EXPECT: 200 with linode02 bots

# Restart spark01
ssh joker@100.100.1.5 'mecha start --host 0.0.0.0 --daemon'
```

### 2c. Concurrent Operations (never stress-tested)

| # | Test | Machine | Notes |
|---|------|---------|-------|
| C-01 | Spawn 5 bots simultaneously — no port collision | linode02 | Parallel spawn |
| C-02 | Stop all bots while one is mid-query — no crash | local | Graceful degradation |
| C-03 | Restart daemon while bots running — bots survive, rediscovered | mac-mini | Detached process survival |

#### C-01 Steps
```bash
# On linode02 — spawn 5 bots in parallel
for i in 1 2 3 4 5; do
  mecha bot start "parallel-$i" --workspace /tmp &
done
wait
mecha bot ls
# EXPECT: all 5 running on different ports, no collision errors
# Cleanup
for i in 1 2 3 4 5; do mecha bot stop "parallel-$i"; done
```

#### C-03 Steps
```bash
# On mac-mini
mecha bot start survivor --workspace /tmp
mecha bot status survivor           # note PID
mecha stop                          # stop daemon (bots detached, survive)
ps aux | grep <pid>                 # EXPECT: bot process still alive
mecha start --host 0.0.0.0 --daemon # restart daemon
mecha bot status survivor           # EXPECT: state: running (rediscovered)
```

---

## Phase 3: Regression Sweep (P1)

Areas not retested since Round 2 or 3. Quick verification that nothing regressed.

| # | Test | Machine | Category | Last Tested |
|---|------|---------|----------|-------------|
| R-01 | `meter start` → `meter status` → `meter stop` cycle | linode02 | Metering | R2 |
| R-02 | Budget set + enforcement: set $1 budget, send query exceeding it | local | Metering | R2 (flaky) |
| R-03 | `schedule add` + `schedule trigger` + `schedule history` | spark01 | Scheduling | R2 |
| R-04 | `session list` → `session show <id>` → `session delete <id>` via CLI | mac-mini | Sessions | R2 |
| R-05 | MCP stdio: `mecha mcp config` → use output to connect from Claude Desktop | local | MCP | R3 |
| R-06 | MCP HTTP: `mecha mcp serve --transport http --port 7682` + MCP tool calls | local | MCP | R3 |
| R-07 | Dashboard: TOTP login → bot list → bot detail tabs (Sessions, Logs, Config) | local (browser) | Dashboard | R4 (partial) |
| R-08 | Auth profile: `auth add` → `auth list` → `auth switch` → `auth remove` | mac-mini | Auth | R2 |

#### R-01 Steps
```bash
# On linode02
mecha meter status                  # EXPECT: not running (or already running)
mecha meter start --port 0
mecha meter status                  # EXPECT: running, shows port/PID
mecha meter stop
mecha meter status                  # EXPECT: not running
```

#### R-02 Steps
```bash
# On local
mecha meter start --port 0
mecha budget set test-bot --daily 0.01
mecha budget list                   # EXPECT: shows test-bot $0.01/day
# Send a query through the bot (triggers metered API call)
# Check: mecha meter status shows cost tracked
# Check: budget enforcement blocks when exceeded
```

#### R-03 Steps
```bash
# On spark01
mecha bot start sched-test --workspace /tmp
mecha schedule add sched-test --cron "0 * * * *" --prompt "ping"
mecha schedule list sched-test      # EXPECT: shows schedule
mecha schedule trigger sched-test <schedule-id>
mecha schedule history sched-test   # EXPECT: shows execution
mecha schedule remove sched-test <schedule-id>
```

---

## Phase 4: Open Issues Documentation (P2)

Known limitations to verify status and document decisions.

| # | Test | Area | Issue | Expected Outcome |
|---|------|------|-------|------------------|
| O-01 | Query via `/query` route — check if meter tracks cost | Metering | R3-005 | Confirm: /query bypasses meter (document as known limitation) |
| O-02 | `mecha bot ls --node spark01` | CLI | F-008 | Confirm: not implemented (document as feature gap) |
| O-03 | `--no-auth` bot, send query — check error message | Chat | R3-008 | Should show clear "no API key" error, not generic 502 |

---

## Execution Order

| Order | Phase | Tests | Est. Time | Priority |
|-------|-------|-------|-----------|----------|
| 1 | Fix Verification | V-01 → V-06 | 15 min | **P0** |
| 2 | Concurrent Ops | C-01 → C-03 | 10 min | **P1** |
| 3 | Sandbox | S-01 → S-05 | 10 min | **P1** |
| 4 | Regression Sweep | R-01 → R-08 | 20 min | **P1** |
| 5 | Network Resilience | N-01 → N-04 | 15 min | **P1** |
| 6 | Open Issues | O-01 → O-03 | 5 min | **P2** |

**Total: 33 tests, ~75 minutes**

## Results Template

Copy this for recording results:

```
| # | Result | Notes |
|---|--------|-------|
| V-01 | | |
| V-02 | | |
| V-03 | | |
| V-04 | | |
| V-05 | | |
| V-06 | | |
| S-01 | | |
| S-02 | | |
| S-03 | | |
| S-04 | | |
| S-05 | | |
| N-01 | | |
| N-02 | | |
| N-03 | | |
| N-04 | | |
| C-01 | | |
| C-02 | | |
| C-03 | | |
| R-01 | | |
| R-02 | | |
| R-03 | | |
| R-04 | | |
| R-05 | | |
| R-06 | | |
| R-07 | | |
| R-08 | | |
| O-01 | | |
| O-02 | | |
| O-03 | | |
```
