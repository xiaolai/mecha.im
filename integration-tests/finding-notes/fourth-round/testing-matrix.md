# Round 4 Integration Testing Matrix

**Version**: v0.2.10
**Date**: 2026-03-10

## What Was Fixed in v0.2.10

### Round 3 Findings Fixed

| ID | Title | Fix |
|----|-------|-----|
| R3-002 | SIGKILL state shows "stopped" not "error" | Exit handler now uses `isCleanExit = code === 0 \|\| (code === null && signal === "SIGTERM")` — all other exits are "error" |
| R3-006 | Query nonexistent bot returns 403 not 404 | Bot existence checked before ACL — returns 404 for missing bots |
| R3-007 | `mecha stop`/`restart` blocked by CLI lock | `stop` and `restart` removed from `MUTATING_COMMANDS` (fixed in v0.2.9+) |
| R3-008 | --no-auth bot query returns generic 502 | Error message now includes upstream detail (e.g. "Upstream bot unavailable: No API credentials") |
| audit | Timeout detection misses wrapped errors | Now checks `err.code`, `err.cause.code`, `err.name`, and `err.cause.name` for timeout variants |

### Still Open (NOT fixed — carried from rounds 1-3)

| ID | Severity | Title | Notes |
|----|----------|-------|-------|
| R3-003 | MEDIUM | Parallel spawn port reuse | Expected behavior — bots that fail health release port back. Not a bug. |
| R3-004 | MEDIUM | Cross-node mesh requires matching TOTP | By design. Needs docs or `node add` secret sync. |
| R3-005 | MEDIUM | Budget enforcement gap on /query route | /query bypasses meter proxy. Design decision pending. |
| R1-002 | HIGH | Stale bot processes cause port conflicts on daemon restart | Untested in R3 |
| R1-006 | P0 | `bot ls` no remote bots (CLI lacks --node) | CLI feature gap |
| R1-007 | P0 | `bot status` no remote syntax | CLI feature gap |
| R1-013 | MEDIUM | --no-auth bot gives unclear error | Improved in v0.2.10 (R3-008), needs re-verify |
| R1-016 | MEDIUM | MCP tools not available to bots | Untested |
| R1-033 | P1 | Force stop during chat fails | Untested in R3 |
| F-008 | MEDIUM | CLI bot ls/status/find lack --node | CLI feature gap |
| F-011 | MEDIUM | Daemon silent crash during MCP testing | Untested in R3 |

---

## Round 4 Testing Matrix

### Priority Legend
- **V** = Verify fix (regression test for v0.2.10 fix)
- **R** = Re-test open finding from prior rounds
- **C** = Carry-forward from R3 skipped tests
- **N** = New test

---

### Category 1: Bot Lifecycle (10 tests)

| # | Test | Type | Tests Fix | Machine | Command/Steps |
|---|------|------|-----------|---------|---------------|
| 4.1.1 | SIGKILL sets state to "error" | V | R3-002 | linode02 | 1. `mecha bot spawn crash-test ~/tmp` 2. `kill -9 <pid>` 3. `mecha bot status crash-test` — state MUST be "error", not "stopped" |
| 4.1.2 | `mecha stop` works while daemon runs | V | R3-007 | linode02 | `mecha stop` — should stop daemon cleanly (no "Another mecha CLI is already running") |
| 4.1.3 | `mecha restart` works while daemon runs | V | R3-007 | linode02 | `mecha bot restart <bot>` — should restart (no CLI lock conflict) |
| 4.1.4 | --no-auth bot error message improved | V | R3-008 | linode02 | `mecha bot spawn noauth ~/tmp --no-auth` then query — error should contain specific detail, not just "Upstream bot unavailable" |
| 4.1.5 | Parallel spawn (sequential verify) | C | R3-003 | linode02 | Spawn 3 bots sequentially, verify unique ports. Then spawn 2 more — verify no collision |
| 4.1.6 | Restart-all no race | C | R1-021 | linode02 | `mecha bot restart-all` with 3+ bots — all should restart |
| 4.1.7 | Stale process cleanup on daemon restart | R | R1-002 | linode02 | 1. Start daemon + spawn 3 bots 2. `kill -9 <daemon-pid>` 3. `mecha start -d --host 0.0.0.0` 4. Verify old bots show as "error" or new spawns don't conflict |
| 4.1.8 | Force stop during active chat | R | R1-033 | linode02 | 1. Start long chat via query 2. `mecha bot stop <name> --force` — should stop cleanly |
| 4.1.9 | Daemon .env loading | C | F-001 | linode02 | 1. Write `ANTHROPIC_API_KEY=...` to `~/.mecha/.env` 2. Start daemon 3. Spawn bot without explicit auth — should inherit .env key |
| 4.1.10 | Bot spawn with custom model | N | - | linode02 | `mecha bot spawn test ~/tmp --model claude-sonnet-4-5-20250514` — verify config.json contains model field |

---

### Category 2: Chat & Query (7 tests)

| # | Test | Type | Tests Fix | Machine | Command/Steps |
|---|------|------|-----------|---------|---------------|
| 4.2.1 | Query nonexistent bot returns 404 | V | R3-006 | linode02 | `POST /bots/ghost-bot/query` with valid auth — MUST return 404 "Bot not found", NOT 403 |
| 4.2.2 | Query nonexistent bot skips ACL | V | R3-006 | linode02 | Same as 4.2.1 but verify ACL engine was not consulted (no ACL log entry) |
| 4.2.3 | Timeout returns 504 (not 502) | V | audit | linode02 | Spawn bot on port, stop it, query before health expires — timeout should return 504 "Upstream bot timed out" |
| 4.2.4 | Cross-node query with matching TOTP | C | R3-004 | linode02→spark01 | 1. Copy TOTP secret from linode02 to spark01 2. Restart spark01 daemon 3. Cross-node query — should succeed (401 resolved) |
| 4.2.5 | Budget enforcement via meter proxy | R | R3-005 | linode02 | Test budget enforcement at `/v1/messages` proxy level (not /query route) — set $0.001 budget, make API calls, verify rejection |
| 4.2.6 | ACL-denied query still returns 403 | V | R3-006 | linode02 | Query existing bot without ACL grant — should return 403 (not changed by reorder) |
| 4.2.7 | Default expose includes query | C | R1-015 | linode02 | Spawn bot without `--expose`, verify default expose includes "query", inter-bot query works |

---

### Category 3: Auth & Security (6 tests)

| # | Test | Type | Tests Fix | Machine | Command/Steps |
|---|------|------|-----------|---------|---------------|
| 4.3.1 | ACL grant/revoke while daemon runs | C | F-004 | linode02 | `mecha acl grant coder query alice` then `mecha acl revoke coder query alice` — both succeed |
| 4.3.2 | TOTP/auth CLI while daemon runs | C | F-004 | linode02 | `mecha totp status` and `mecha auth ls` — both succeed (no lock error) |
| 4.3.3 | Budget/meter CLI while daemon runs | C | R1-025 | linode02 | `mecha budget ls`, `mecha meter status`, `mecha cost` — all succeed |
| 4.3.4 | Bearer auth requires X-Mecha-Source | C | audit#1 | linode02 | `curl -H "Authorization: Bearer <mesh-key>" /bots` without X-Mecha-Source — returns 401 |
| 4.3.5 | ACL changes picked up live | C | R1-014 | linode02 | Grant ACL, immediately query — should succeed without daemon restart |
| 4.3.6 | $env: auth profile quoting | R | R1-026 | linode02 | `mecha auth add test-key '$env:MY_KEY'` — verify stored correctly, bot spawn uses it |

---

### Category 4: Mesh & Multi-Machine (9 tests)

| # | Test | Type | Tests Fix | Machine | Command/Steps |
|---|------|------|-----------|---------|---------------|
| 4.4.1 | Node name correct in /node/info | C | F-007 | linode02 | `curl /node/info` — should return correct node name |
| 4.4.2 | Remote bot list via ?node= | C | F-013 | linode02 | `GET /bots?node=spark01` — returns spark01's bots |
| 4.4.3 | Remote sessions via ?node= | C | F-013 | linode02 | `GET /bots/<bot>/sessions?node=spark01` — returns sessions |
| 4.4.4 | Cross-node query (matching TOTP) | V | R3-004 | linode02→spark01 | After TOTP sync: `POST /bots/<bot>/query?node=spark01` — should succeed (not 401) |
| 4.4.5 | Cross-node query unknown node | C | - | linode02 | `?node=nonexistent` — returns 404 "Node not found" |
| 4.4.6 | Daemon registry sync | C | R1-034 | linode02 | CLI `bot ls` and API `/bots` return identical results |
| 4.4.7 | /discover local + tag/capability filter | C | F-009 | linode02 | `GET /discover`, `GET /discover?tag=code`, `GET /discover?capability=query` — all filter correctly |
| 4.4.8 | CLI bot ls --node (if added) | R | R1-006/F-008 | linode02 | `mecha bot ls --node spark01` — verify remote bots listed (if feature exists) |
| 4.4.9 | Bidirectional node registration | C | - | linode02↔spark01 | Register each node with the other, verify both `node ls` show the peer |

---

### Category 5: Metering & Budgets (4 tests)

| # | Test | Type | Tests Fix | Machine | Command/Steps |
|---|------|------|-----------|---------|---------------|
| 4.5.1 | Meter records non-zero cost | C | R1-009 | linode02 | Chat with bot, `mecha cost` — shows >$0.00 |
| 4.5.2 | Budget enforcement at meter proxy | R | R3-005/R1-010 | linode02 | Set very low budget, make `/v1/messages` API calls through meter proxy, verify rejection when budget exceeded |
| 4.5.3 | Meter survives daemon restart | R | - | linode02 | 1. Record costs 2. Restart daemon 3. `mecha cost` — totals preserved |
| 4.5.4 | Budget CLI (set/ls) | C | R1-025 | linode02 | `mecha budget set --daily 10.00 --bot test-bot`, `mecha budget ls` — both work |

---

### Category 6: Sandbox & Hooks (4 tests)

| # | Test | Type | Tests Fix | Machine | Command/Steps |
|---|------|------|-----------|---------|---------------|
| 4.6.1 | sandbox-guard.sh syntax | C | R1-018 | linode02 | Spawn bot, `bash -n <bot-dir>/.claude/hooks/sandbox-guard.sh` — exits 0 |
| 4.6.2 | bash-guard.sh syntax | C | R1-019 | linode02 | `bash -n <bot-dir>/.claude/hooks/bash-guard.sh` — exits 0 |
| 4.6.3 | macOS Seatbelt sandbox | R | - | mac-mini | `mecha bot spawn test ~/tmp --sandbox auto` — verify Seatbelt profile generated in bot dir |
| 4.6.4 | Spawn with sandbox off | C | - | linode02 | `mecha bot spawn test ~/tmp --sandbox off` — verify no hooks/guard generated |

---

### Category 7: MCP Server (4 tests)

| # | Test | Type | Tests Fix | Machine | Command/Steps |
|---|------|------|-----------|---------|---------------|
| 4.7.1 | MCP config real binary path | C | R1-027 | linode02 | `mecha mcp config` — real path, not `/$bunfs/...` |
| 4.7.2 | Workspace/files API | C | R1-035 | linode02 | `GET /bots/<bot>/files` — returns directory listing |
| 4.7.3 | MCP serve with MECHA_DIR | R | R1-029 | linode02 | `MECHA_DIR=~/.mecha mecha mcp serve --transport http --port 7680` — verify functional |
| 4.7.4 | MCP tools available to bots | R | R1-016 | linode02 | Spawn bot with `--mcp-config` pointing to mecha MCP, query bot to list available tools |

---

### Category 8: Dashboard & SPA (4 tests)

| # | Test | Type | Tests Fix | Machine | Command/Steps |
|---|------|------|-----------|---------|---------------|
| 4.8.1 | Dashboard loads and shows bots | C | - | linode02 | Open `http://linode02:7660` in browser, verify bot list, node name visible |
| 4.8.2 | Dashboard remote node view | C | F-013 | linode02 | Navigate to remote node tab — verify remote bots displayed |
| 4.8.3 | Dashboard bot chat (query) | N | - | linode02 | Open bot chat in dashboard, send message, verify response |
| 4.8.4 | Dashboard ACL/settings page | C | F-004 | linode02 | Verify settings pages load while daemon runs |

---

### Category 9: Upgrade & Recovery (4 tests)

| # | Test | Type | Tests Fix | Machine | Command/Steps |
|---|------|------|-----------|---------|---------------|
| 4.9.1 | Upgrade linode02 v0.2.9→v0.2.10 | V | - | linode02 | Replace binary, restart daemon, verify version, bots preserved |
| 4.9.2 | Upgrade spark01 v0.2.9→v0.2.10 | V | - | spark01 | Replace binary, restart daemon, verify version |
| 4.9.3 | Upgrade mac-mini v0.2.9→v0.2.10 | V | - | mac-mini | `brew upgrade mecha`, restart daemon |
| 4.9.4 | Daemon crash recovery | R | F-011 | linode02 | `kill -9 <daemon-pid>`, `mecha start -d --host 0.0.0.0`, verify bots rediscovered |

---

## Summary

| Category | Verify Fix | Re-test | Carry-fwd | New | Total |
|----------|-----------|---------|-----------|-----|-------|
| 1. Bot Lifecycle | 4 | 2 | 3 | 1 | 10 |
| 2. Chat & Query | 4 | 1 | 2 | 0 | 7 |
| 3. Auth & Security | 0 | 1 | 5 | 0 | 6 |
| 4. Mesh & Multi-Machine | 1 | 1 | 6 | 0 | 8+1 |
| 5. Metering & Budgets | 0 | 2 | 2 | 0 | 4 |
| 6. Sandbox & Hooks | 0 | 1 | 3 | 0 | 4 |
| 7. MCP Server | 0 | 2 | 2 | 0 | 4 |
| 8. Dashboard & SPA | 0 | 0 | 3 | 1 | 4 |
| 9. Upgrade & Recovery | 3 | 1 | 0 | 0 | 4 |
| **Total** | **12** | **11** | **26** | **2** | **51** |

### Execution Order (by priority)

1. **Upgrade first** (4.9.1, 4.9.2, 4.9.3) — install v0.2.10 on all machines
2. **Verify R3 fixes** (4.1.1-4.1.4, 4.2.1-4.2.3, 4.2.6) — R3-002, R3-006, R3-007, R3-008, timeout detection
3. **Cross-node TOTP sync + query** (4.2.4, 4.4.4) — R3-004 resolution
4. **Carry-forward passing tests** (4.1.5-4.1.6, 4.3.x, 4.4.x, 4.6.x, 4.7.x) — quick regression pass
5. **Re-test open findings** (4.1.7-4.1.8, 4.2.5, 4.3.6, 4.5.2-4.5.3, 4.6.3, 4.7.3-4.7.4)
6. **Dashboard tests** (4.8.x) — if browser available
7. **New tests** (4.1.10, 4.8.3)

### Machines

| Machine | Primary Tests | Notes |
|---------|--------------|-------|
| linode02 (x64) | All categories | Primary test machine |
| spark01 (arm64) | 4.4.x (mesh target), 4.9.2 | Remote node — needs TOTP sync for cross-node tests |
| mac-mini (macOS arm64) | 4.6.3 (Seatbelt), 4.9.3 | macOS-specific sandbox testing |

### Key Differences from Round 3

1. **TOTP sync test** (4.2.4, 4.4.4): Round 3 discovered cross-node auth fails with mismatched TOTP. Round 4 explicitly syncs secrets before testing cross-node queries.
2. **Budget at proxy level** (4.2.5, 4.5.2): Round 3 showed /query bypasses meter. Round 4 tests budget enforcement at the correct layer (`/v1/messages` proxy).
3. **504 timeout branch** (4.2.3): New code path added in v0.2.10 — needs integration verification.
4. **Fewer tests** (51 vs 67): Removed tests for features that don't exist yet (CLI --node flags) and consolidated redundant tests. Focused on verifying fixes + re-testing failures.
