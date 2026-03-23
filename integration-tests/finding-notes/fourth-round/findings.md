# Round 4 Integration Test Findings

**Version**: v0.2.10
**Date**: 2026-03-10
**Tester**: Claude (automated via SSH)

## Machines

| Machine | IP | Version | Platform |
|---------|-----|---------|----------|
| local (joker-mbp) | 127.0.0.1 | 0.2.10 | macOS arm64 |
| linode02 | 100.100.1.9 | 0.2.10 | Linux x64 |
| spark01 | 100.100.1.5 | 0.2.10 | Linux arm64 |
| mac-mini | 100.100.1.7 | 0.2.10 | macOS arm64 |

---

## New Findings

### R4-001: Exit handler is dead code for detached+unref'd children (HIGH)

**Severity**: HIGH
**Category**: Bot Lifecycle
**File**: `packages/process/src/spawn-pipeline.ts:251-282`

The `child.on("exit", ...)` handler (lines 251-282) in `spawnBot` is dead code. After `child.unref()` (line 244), Node.js stops tracking the child process, so exit events are **never delivered** for detached+unref'd processes.

**Impact**: When a bot process dies unexpectedly (SIGKILL, crash), `state.json` permanently shows "running" until a `getBot()`/`listBots()` call triggers dead-PID detection. The dead-PID detection in `process-manager.ts` always writes state "stopped" instead of "error".

**Root cause**: `child.unref()` is necessary for daemon detachment, but it means Node.js event loop doesn't wait for the child, and exit events may not fire.

**Detection path**: The ONLY working detection is the dead-PID check in `getBot()`/`listBots()`:
- `packages/process/src/process-manager.ts:97-109` (getBot)
- `packages/process/src/process-manager.ts:124-136` (listBots)
- `packages/process/src/discovery-index.ts:38-56` (daemon init scan)

All write `state: "stopped"` instead of `state: "error"` for unexpected deaths.

**Fix locations**:
1. `process-manager.ts` lines 104-105: Change `state.state = "stopped"` to `state.state = "error"`
2. `process-manager.ts` lines 131-132: Same change
3. `discovery-index.ts` lines ~48: Same change
4. Consider removing or marking the dead `child.on("exit", ...)` handler with a comment explaining it never fires

**Observed**: `kill -9 <bot-pid>` → `mecha bot status <bot>` shows "stopped" not "error"

---

### R4-002: `bot start` token mismatch with stale process (HIGH)

**Severity**: HIGH
**Category**: Bot Lifecycle
**File**: `packages/process/src/spawn-pipeline.ts:51-64`, `packages/cli/src/commands/bot-start.ts`

When a bot process is still running but its `state.json` says "stopped" (due to R4-001), `bot start` spawns a new process with a new token. The new token is written to `config.json`, but the OLD process is still bound to the port with the OLD token. Result: `forwardQueryToBot` reads the new token from config.json and sends it to the old process, which rejects it with 401.

**Impact**: All queries to the bot fail with "Target returned HTTP 401 — check auth token" after a `bot start` on a stale-state bot.

**Root cause**: `spawnBot` checks `live` map and `state.json` for running bots, but doesn't verify if the PID is actually alive before spawning. The new spawn may succeed on a different port (or same port if old process died), but `config.json` gets the new token.

**Fix**: Before spawning, check if `state.pid` is alive and kill it if so. Or: `bot start` should call `isPidAlive()` on the persisted PID and kill it before re-spawning.

**Observed on**: spark01 — coder bot had `MECHA_AUTH_TOKEN=mecha_c971a648...` in process env but config.json had `token=mecha_6533473a50...`

---

### R4-003: Managed node entry activates signature hook unexpectedly (MEDIUM)

**Severity**: MEDIUM
**Category**: Mesh & Multi-Machine
**File**: `packages/agent/src/server.ts:101-117`, `packages/agent/src/auth.ts:123-202`

When a node's `nodes.json` contains entries with `publicKey` fields (e.g., from prior discovery/managed-node registration), the signature verification hook activates. The routing code in `routing.ts` does NOT send signatures (`signFn` is not passed to `agentFetch`), causing all cross-node queries to fail with 401 "Missing signature or source header".

**Impact**: Cross-node queries fail after any discovery event that registers a node with a public key.

**Root cause**: `loadNodePublicKeys()` returns non-empty map when any node entry has `publicKey` → getter returns the map (not undefined) → signature hook is active → all routing requests require signatures → routing code doesn't send signatures.

**Fix options**:
1. Have routing code pass `signFn` when the local node has a key pair
2. Only activate signature hook for nodes explicitly configured for signed routing
3. Separate `publicKey` for identity from "require signature" flag

**Workaround**: Remove stale `publicKey` entries from `nodes.json`

---

### R4-004: MCP serve default port conflicts with meter proxy (LOW)

**Severity**: LOW
**Category**: MCP Server
**File**: `packages/cli/src/commands/mcp-serve.ts`

`mecha mcp serve --transport http` defaults to port 7680, which conflicts with the meter proxy that also binds to 7680 when the daemon is running.

**Fix**: Use a different default port for MCP HTTP transport (e.g., 7681) or document the conflict.

---

## Test Results

### Category 1: Bot Lifecycle

| # | Test | Result | Notes |
|---|------|--------|-------|
| 4.1.1 | SIGKILL sets state to "error" | **FAIL** | R4-001: Exit handler never fires (dead code). Dead-PID check writes "stopped" not "error" |
| 4.1.2 | `mecha stop` works while daemon runs | PASS | Daemon stopped cleanly, no lock conflict |
| 4.1.3 | `mecha restart` works while daemon runs | PASS | Bot restarted successfully |
| 4.1.4 | --no-auth bot error message improved | PARTIAL | Error says "Upstream bot unavailable: Target returned HTTP 0" — better than before but still not specific about missing API credentials |
| 4.1.5 | Parallel spawn (sequential verify) | PASS | Running bots have unique ports (7700, 7701). Stopped bots correctly release ports |
| 4.1.6 | Restart-all no race | PASS | All 5 bots restarted successfully, no race conditions |
| 4.1.7 | Stale process cleanup on daemon restart | PASS | Daemon restart after SIGKILL: bots survive (detached), daemon re-discovers them, no port conflicts |
| 4.1.8 | Force stop during active chat | PASS | `bot stop --force` cleanly stopped bot mid-request |
| 4.1.9 | Daemon .env loading | PASS | Daemon loads ANTHROPIC_API_KEY from ~/.mecha/.env, bots inherit without explicit --auth |
| 4.1.10 | Bot spawn with custom model | PASS | `--model claude-sonnet-4-5-20250514` correctly stored in config.json |

### Category 2: Chat & Query

| # | Test | Result | Notes |
|---|------|--------|-------|
| 4.2.1 | Query nonexistent bot returns 404 | PASS | Returns 404 "Bot not found: ghost-bot" |
| 4.2.2 | Query nonexistent bot skips ACL | PASS | ACL `check` not called for missing bots |
| 4.2.3 | Timeout returns 504 (not 502) | PARTIAL | Stopped bot returns 502 (connection refused, not timeout). 504 code path verified via unit tests only — requires actual TCP timeout to trigger in integration |
| 4.2.4 | Cross-node query with matching TOTP | PASS | After TOTP sync + stale node entry cleanup + ACL grant, cross-node query succeeds |
| 4.2.5 | Budget enforcement via meter proxy | PARTIAL | Budget exceeded → bot times out (504) instead of clean "budget exceeded" error. Confirms R3-005 |
| 4.2.6 | ACL-denied query still returns 403 | PASS | 403 "Access denied" for existing bot without ACL grant |
| 4.2.7 | Default expose includes query | PASS | Default `expose: ["query"]` confirmed in config.json |

### Category 3: Auth & Security

| # | Test | Result | Notes |
|---|------|--------|-------|
| 4.3.1 | ACL grant/revoke while daemon runs | PASS | Both operations succeed without lock error |
| 4.3.2 | TOTP/auth CLI while daemon runs | PASS | `totp status` and `auth ls` work fine |
| 4.3.3 | Budget/meter CLI while daemon runs | PASS | `budget ls`, `meter status`, `cost` all succeed |
| 4.3.4 | Bearer auth requires X-Mecha-Source | PASS | Request without X-Mecha-Source returns 401 |
| 4.3.5 | ACL changes picked up live | PASS | ACL grant immediately effective without restart |
| 4.3.6 | $env: auth profile | PASS | `mecha auth add test-env-key --api-key --token '$env:MY_TEST_KEY'` stored correctly |

### Category 4: Mesh & Multi-Machine

| # | Test | Result | Notes |
|---|------|--------|-------|
| 4.4.1 | Node name correct in /node/info | PARTIAL | Shows node name but may show "unknown" for auto-detected name |
| 4.4.2 | Remote bot list via ?node= | PASS | Returns spark01's bots (remote-worker, coder) |
| 4.4.3 | Remote sessions via ?node= | PASS | Sessions retrieved from remote node |
| 4.4.4 | Cross-node query (matching TOTP) | PASS | linode02 → spark01 coder: 200 OK after fixing R4-002 (token mismatch) and R4-003 (signature hook) |
| 4.4.5 | Cross-node query unknown node | PASS | Returns 404 "Node not found: nonexistent" |
| 4.4.6 | Daemon registry sync | PASS | CLI `bot ls` and API `/bots` return identical results |
| 4.4.7 | /discover local + filter | PASS | Discovery endpoint with tag/capability filters works correctly |
| 4.4.8 | CLI bot ls --node | FAIL | `--node` flag not implemented (known gap R1-006/F-008) |
| 4.4.9 | Bidirectional node registration | PASS | Both nodes see each other after mutual `node add` |

### Category 5: Metering & Budgets

| # | Test | Result | Notes |
|---|------|--------|-------|
| 4.5.1 | Meter records non-zero cost | PASS | $1.77 total today across bots |
| 4.5.2 | Budget enforcement at meter proxy | PARTIAL | Budget exceeded causes bot timeout (504), not clean 429 rejection at query level. Confirms R3-005 |
| 4.5.3 | Meter survives daemon restart | PASS | Cost data preserved across daemon kill + restart ($1.77 → $1.82) |
| 4.5.4 | Budget CLI (set/ls) | PASS | `budget set` and `budget ls` work correctly |

### Category 6: Sandbox & Hooks

| # | Test | Result | Notes |
|---|------|--------|-------|
| 4.6.1 | sandbox-guard.sh syntax | PASS | `bash -n` exits 0 |
| 4.6.2 | bash-guard.sh syntax | PASS | `bash -n` exits 0 |
| 4.6.3 | macOS Seatbelt sandbox | PASS | `sandbox-profile.json` generated with `platform=macos` on mac-mini |
| 4.6.4 | Spawn with sandbox off | PASS | Bot spawned on port 7703, hooks still present (guard scripts are always generated) |

### Category 7: MCP Server

| # | Test | Result | Notes |
|---|------|--------|-------|
| 4.7.1 | MCP config real binary path | PASS | Shows `/usr/local/bin/mecha` (not `/$bunfs/...`) |
| 4.7.2 | Workspace/files API | PASS | Returns directory listing with files and directories |
| 4.7.3 | MCP serve with MECHA_DIR | PASS | Starts on port 7681 (`MCP HTTP server listening`). Default port 7680 conflicts with meter proxy (R4-004) |
| 4.7.4 | MCP tools available to bots | SKIP | Requires bot with `--mcp-config` pointing to mecha MCP — complex setup, deferred |

### Category 8: Dashboard & SPA

| # | Test | Result | Notes |
|---|------|--------|-------|
| 4.8.1 | Dashboard loads and shows bots | PASS | SPA returns 200 (658 bytes HTML) |
| 4.8.2 | Dashboard remote node view | PASS | Remote bots visible via API (2 bots on spark01) |
| 4.8.3 | Dashboard bot chat (query) | SKIP | Requires browser interaction |
| 4.8.4 | Dashboard ACL/settings page | SKIP | Requires browser interaction |

### Category 9: Upgrade & Recovery

| # | Test | Result | Notes |
|---|------|--------|-------|
| 4.9.1 | Upgrade linode02 v0.2.9→v0.2.10 | PASS | Binary replaced, daemon restarted, bots preserved |
| 4.9.2 | Upgrade spark01 v0.2.9→v0.2.10 | PASS | Binary replaced, daemon restarted, coder started |
| 4.9.3 | Upgrade mac-mini v0.2.9→v0.2.10 | PASS | `brew upgrade mecha` succeeded |
| 4.9.4 | Daemon crash recovery | PASS | Tested in 4.1.7 — daemon restart after kill -9, bots rediscovered |

---

## Summary

| Category | Pass | Partial | Fail | Skip | Total |
|----------|------|---------|------|------|-------|
| 1. Bot Lifecycle | 8 | 1 | 1 | 0 | 10 |
| 2. Chat & Query | 4 | 2 | 0 | 0 | 6+1 |
| 3. Auth & Security | 6 | 0 | 0 | 0 | 6 |
| 4. Mesh & Multi-Machine | 7 | 1 | 1 | 0 | 9 |
| 5. Metering & Budgets | 3 | 1 | 0 | 0 | 4 |
| 6. Sandbox & Hooks | 4 | 0 | 0 | 0 | 4 |
| 7. MCP Server | 3 | 0 | 0 | 1 | 4 |
| 8. Dashboard & SPA | 2 | 0 | 0 | 2 | 4 |
| 9. Upgrade & Recovery | 4 | 0 | 0 | 0 | 4 |
| **Total** | **41** | **5** | **2** | **3** | **51** |

### New Findings Summary

| ID | Severity | Title | Fix Required |
|----|----------|-------|--------------|
| R4-001 | HIGH | Exit handler dead code for unref'd children | Yes — change dead-PID detection to write "error" not "stopped" |
| R4-002 | HIGH | `bot start` token mismatch with stale process | Yes — kill stale PID before re-spawning |
| R4-003 | MEDIUM | Managed node entry activates signature hook | Yes — routing code should handle or disable signature requirement |
| R4-004 | LOW | MCP serve default port conflicts with meter | Yes — change default port |

### Carried Forward (Still Open)

| ID | Severity | Title | Status |
|----|----------|-------|--------|
| R3-005 | MEDIUM | Budget enforcement gap on /query route | Confirmed in 4.2.5 and 4.5.2 |
| R1-006/F-008 | P0 | CLI bot ls/status/find lack --node | Confirmed in 4.4.8 — `--node` not implemented |
| R1-016 | MEDIUM | MCP tools not available to bots | Skipped (complex setup) |

### Round 3 Fixes Verified

| Fix | Test | Verified |
|-----|------|----------|
| R3-002 (SIGKILL state) | 4.1.1 | PARTIAL — exit handler is dead code (R4-001), dead-PID check writes "stopped" |
| R3-006 (404 not 403) | 4.2.1, 4.2.2, 4.2.6 | YES — bot existence checked before ACL |
| R3-007 (CLI lock) | 4.1.2, 4.1.3 | YES — stop/restart work without lock conflict |
| R3-008 (--no-auth error) | 4.1.4 | PARTIAL — error is more specific but still generic |
| Audit (timeout detection) | 4.2.3 | PARTIAL — unit-tested; integration requires real TCP timeout |
