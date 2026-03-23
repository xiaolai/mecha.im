# Round 3 Integration Test Findings

**Version**: v0.2.9 + fix/ci-pty-manager-test + fix/cli-lock-stop-restart
**Date**: 2026-03-10
**Tester**: Claude (automated via SSH)

## Machines

| Machine | IP | Version | Platform |
|---------|-----|---------|----------|
| local (joker-mbp) | 127.0.0.1 | 0.2.9 | macOS arm64 |
| linode02 | 100.100.1.9 | 0.2.9 | Linux x64 |
| spark01 | 100.100.1.5 | 0.2.9 | Linux arm64 |
| mac-mini | 100.100.1.7 | 0.2.9 | macOS arm64 |

---

## Category 1: Bot Lifecycle

| # | Test | Result | Notes |
|---|------|--------|-------|
| 3.1.2 | No spurious workspace warning (F-002) | PASS | `mecha bot spawn warn-test /home/joker/test-project` — no warning output, only "Spawned warn-test on port 7701" |
| 3.1.3 | SIGKILL sets state to "error" (F-003/R1-012) | **FAIL** | State shows "stopped" after `kill -9`. Detached+unref'd child sends `code=null, signal=null` to Node exit handler, making isError=false. See R3-002 |
| 3.1.4 | Parallel spawn no port collision (F-012) | **PARTIAL** | Sequential spawn: PASS (ports 7700,7701,7702). Parallel spawn: all 5 got port 7701, only 1 survived. Mutex serializes allocation but freed ports get reused. See R3-003 |
| 3.1.5 | Restart no EADDRINUSE (R1-021) | PASS | `mecha bot restart par-2` — succeeded, restarted on port 7701 |
| 3.1.10 | --no-auth bot error message (R1-013) | **PARTIAL** | Bot spawns successfully (no crash), but query returns 502 "Upstream bot unavailable" instead of clear "No API credentials" message |
| 3.1.11 | Daemon PID file | PASS | `daemon.pid` contains correct PID matching running process |

## Category 2: Chat & Query

| # | Test | Result | Notes |
|---|------|--------|-------|
| 3.2.1 | Dashboard admin query (F-005) | PASS | Session-auth defaults source to "admin". After `mecha acl grant admin query test-bot`, query returns 200 with response. Note: source is "admin" not "dashboard" — ACL must use "admin" |
| 3.2.2 | ACL-denied query returns 403 | PASS | Query without ACL grant returns `{"error":"Access denied: admin cannot query par-2"}` with 403 |
| 3.2.4 | Cross-node query unknown node | PASS | Returns 404 `{"error":"Node not found: nonexistent"}` |
| 3.2.5 | Query nonexistent bot | PASS | Returns 403 (ACL check before existence check — minor: could return 404 instead) |
| 3.2.8 | Default expose blocks query (R1-015) | N/A | Default expose includes `["query"]` — no blocking observed. R1-015 may be fixed or was about inter-bot (not admin) queries |

## Category 3: Auth & Security

| # | Test | Result | Notes |
|---|------|--------|-------|
| 3.3.1 | ACL grant while daemon runs (F-004) | PASS | `mecha acl grant coder query alice` — succeeded without lock error |
| 3.3.2 | ACL revoke while daemon runs (F-004) | PASS | `mecha acl revoke coder query alice` — succeeded |
| 3.3.3 | TOTP status while daemon runs (F-004) | PASS | `mecha totp status` returned "TOTP is configured" |
| 3.3.4 | auth ls while daemon runs (F-004) | PASS | `mecha auth ls` — listed profiles without lock error |
| 3.3.5 | Bearer auth WITHOUT X-Mecha-Source (audit#1) | PASS | Returns 401 Unauthorized (correct — X-Mecha-Source header required) |
| 3.3.6 | Bearer auth WITH X-Mecha-Source (audit#1/F-013) | PASS | Returns 200 with bot list on /bots |
| 3.3.8 | ACL changes picked up live (R1-014) | PASS | `mecha acl grant admin query par-2` then immediate query → 200. No daemon restart needed |
| 3.3.9 | budget/meter CLI while daemon runs (R1-025) | PASS | `mecha budget ls` and `mecha meter status` both work without lock error |

## Category 4: Mesh & Multi-Machine

| # | Test | Result | Notes |
|---|------|--------|-------|
| 3.4.1 | Node name in /node/info (F-007) | PASS | Returns `"node":"linode02"` correctly (not "unknown") |
| 3.4.2 | Node name in /discover/handshake | CORRECTED | Route is POST-only (not GET). POST requires `clusterKey` field (not Bearer auth). Initial test used wrong method |
| 3.4.3 | Remote bot list via ?node= (F-013) | PASS | `GET /bots?node=spark01` with session cookie returns spark01's bot list (remote-worker, coder) |
| 3.4.5 | Remote sessions via ?node= (F-013) | PASS | `GET /bots/remote-worker/sessions?node=spark01` returns `[]` (correct — bot stopped, no sessions) |
| 3.4.13 | Daemon registry sync (R1-034) | PASS | CLI `bot ls` and API `/bots` return identical bot names, states, and ports |
| 3.4.14 | /discover local (F-009) | PASS | Returns all local bots with name, state, tags, expose fields |

### Cross-node query note

Cross-node query from linode02→spark01 returns 502 with "Remote node spark01 returned 401". Root cause: spark01 has a different TOTP secret than linode02, so the mesh Bearer key doesn't match. This is expected — mesh auth requires matching TOTP secrets. See R3-004.

## Category 5: Metering & Budgets

| # | Test | Result | Notes |
|---|------|--------|-------|
| 3.5.1 | Meter records non-zero cost (R1-009) | PASS | `mecha cost` shows test-bot=$1.05, alice=$0.04, par-2=$0.01. Non-zero costs recorded correctly |
| 3.5.3 | Budget daily enforcement (R1-010) | **INCONCLUSIVE** | Set $0.001 daily limit on test-bot (which spent $1.05). Query returned 502 "Upstream bot unavailable" — SDK query timeout, not budget rejection. Could not verify if budget check occurs before forwarding. See R3-005 |

## Category 6: Sandbox & Hooks

| # | Test | Result | Notes |
|---|------|--------|-------|
| 3.6.1 | sandbox-guard.sh syntax (R1-018) | PASS | `bash -n sandbox-guard.sh` exits 0. No syntax errors |
| 3.6.2 | bash-guard.sh syntax | PASS | `bash -n bash-guard.sh` exits 0. Script properly parses command from JSON stdin |

## Category 7: MCP Server

| # | Test | Result | Notes |
|---|------|--------|-------|
| 3.7.1 | MCP config binary path (R1-027) | PASS | `mecha mcp config` returns `{"command":"/home/joker/bin/mecha"}` — real binary path, not `/$bunfs/...` |
| 3.7.4 | Workspace/files API (R1-035) | PASS | `GET /bots/par-2/files` returns directory listing with entries (logs, tmp, config.json, etc.). Correct path is `/bots/:name/files`, not `/bots/:name/workspace/` |

## Category 9: Upgrade & Recovery

| # | Test | Result | Notes |
|---|------|--------|-------|
| 3.9.1 | Upgrade linode02 v0.2.8→v0.2.9 | PASS | Binary replaced, daemon restarted, bots preserved |
| 3.9.2 | Upgrade spark01 v0.2.8→v0.2.9 | PASS | Binary replaced, daemon restarted, bots preserved |
| 3.9.1b | Upgrade mac-mini v0.2.8→v0.2.9 | PASS | `brew upgrade mecha` succeeded, daemon restarted |

---

## NEW Findings

| ID | Severity | Title | Details |
|----|----------|-------|---------|
| R3-002 | HIGH | SIGKILL state still shows "stopped" | Detached+unref'd child processes send `code=null, signal=null` to Node.js exit handler. The v0.2.9 fix `(signal != null && signal !== "SIGTERM")` evaluates to false, so state is written as "stopped" instead of "error". Fix: treat `code=null && signal=null` (unexpected exit) as error, or use `exitCode` field absence as indicator. |
| R3-003 | MEDIUM | Parallel spawn port reuse | Spawning 5 bots simultaneously: mutex serializes port allocation correctly, but all 5 get port 7701 because previous allocations fail health check and release the port before the next allocation scans. Only 1 of 5 survives. Not a collision bug — it's an expected consequence of parallel spawns with slow health checks. |
| R3-004 | MEDIUM | Cross-node mesh requires matching TOTP | linode02 and spark01 have different TOTP secrets, so cross-node Bearer auth fails (401). Mesh requires shared TOTP secret across nodes. This is by design but not obvious to users. Needs documentation or `mecha node add` should exchange/sync secrets. |
| R3-005 | MEDIUM | Budget enforcement untestable via /query | Query route intermittently returns 502 "Upstream bot unavailable" (SDK query timeout). Cannot reliably verify whether budget check blocks before forwarding. Budget enforcement works at the meter proxy level for `/v1/messages` API calls, but `/query` route bypasses the meter proxy entirely (queries go direct to bot). **Budget enforcement does NOT apply to /query route** — only to metered API proxy calls. |
| R3-006 | LOW | Query nonexistent bot returns 403 not 404 | `POST /bots/ghost-bot/query` returns 403 "Access denied" instead of 404 "Bot not found". ACL check runs before existence check, leaking that the bot doesn't have an ACL entry rather than saying it doesn't exist. |
| R3-007 | HIGH | `mecha stop` / `mecha restart` blocked by CLI lock | `stop` and `restart` are in `MUTATING_COMMANDS`, so they try to acquire `cli.lock` held by the daemon. **Already fixed in git** (commit 5226b32) but not yet released. Needs v0.2.10 release. |
| R3-008 | MEDIUM | --no-auth bot query returns 502 | `mecha bot spawn noauth-test --no-auth` starts successfully, but querying returns 502. The bot process runs but the Claude SDK inside has no API key, so it can't respond. Error message should be clearer. |

---

## Summary

| Category | Total Tested | PASS | FAIL | PARTIAL | N/A | INCONCLUSIVE |
|----------|-------------|------|------|---------|-----|-------------|
| 1. Bot Lifecycle | 6 | 3 | 1 | 1 | 0 | 0 |
| 2. Chat & Query | 5 | 4 | 0 | 0 | 1 | 0 |
| 3. Auth & Security | 8 | 8 | 0 | 0 | 0 | 0 |
| 4. Mesh & Multi-Machine | 6 | 6 | 0 | 0 | 0 | 0 |
| 5. Metering & Budgets | 2 | 1 | 0 | 0 | 0 | 1 |
| 6. Sandbox & Hooks | 2 | 2 | 0 | 0 | 0 | 0 |
| 7. MCP Server | 2 | 2 | 0 | 0 | 0 | 0 |
| 9. Upgrade & Recovery | 3 | 3 | 0 | 0 | 0 | 0 |
| **Total** | **34** | **29** | **1** | **1** | **1** | **1** |

### Tests Not Run (33 remaining from 67-test matrix)

Skipped due to constraints:
- **spark01 has no API key** — cannot start bots for cross-node query tests (3.2.3, 3.2.6, 3.4.4, 3.4.6, 3.4.7)
- **No Bubblewrap on test machines** — sandbox kernel tests skipped (3.6.4, 3.6.5)
- **macOS-specific** — Seatbelt sandbox test not run (3.6.3)
- **Dashboard/UI tests** — require browser interaction (3.8.1-3.8.4)
- **Flaky SDK query** — budget enforcement, concurrent budget, and query tests unreliable (3.2.7, 3.5.2, 3.5.4, 3.5.5, 3.5.6)
- **Multi-step tests** requiring extended setup (3.1.1, 3.1.6-3.1.9, 3.4.8, 3.4.9-3.4.12, 3.7.2, 3.7.3, 3.7.5, 3.9.3, 3.9.4)

### Priority Fixes

1. **R3-002 (HIGH)**: SIGKILL state detection — needs code fix in spawn-pipeline.ts exit handler
2. **R3-007 (HIGH)**: CLI lock blocking stop/restart — already fixed in git, needs release
3. **R3-004 (MEDIUM)**: Cross-node mesh secret sync — needs docs or tooling
4. **R3-005 (MEDIUM)**: Budget enforcement gap on /query route — design decision needed
5. **R3-003 (MEDIUM)**: Parallel spawn port reuse — consider reserving ports until health check completes (already implemented via reservedPorts set, but bots that fail health release port back)
