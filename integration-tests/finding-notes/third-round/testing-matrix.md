# Round 3 Integration Testing Matrix

**Version**: v0.2.9
**Date**: 2026-03-10

## What Was Fixed in v0.2.8 + v0.2.9

### Round 1 Findings Fixed

| ID | Title | Fixed In |
|----|-------|----------|
| R1-001 | /api/chat hangs (SDK can't spawn claude) | v0.2.8 |
| R1-009 | Meter zero cost (compressed SSE) | v0.2.8 |
| R1-012 | SIGKILL state shows "stopped" not "error" | v0.2.9 |
| R1-021 | Restart EADDRINUSE race condition | v0.2.8 (retry logic) |
| R1-032 | Parallel spawn port collision | v0.2.9 (mutex) |

### Round 2 Findings Fixed

| ID | Title | Fixed In |
|----|-------|----------|
| F-001 | Daemon doesn't load .env | v0.2.9 |
| F-002 | Spurious workspace path warning | v0.2.9 |
| F-003 | SIGKILL→stopped (same as R1-012) | v0.2.9 |
| F-004 | CLI lock blocks acl/totp/auth-config | v0.2.9 |
| F-005 | /query requires X-Mecha-Source for admin | v0.2.9 |
| F-007 | Node name shows "unknown" | v0.2.9 |
| F-012 | Concurrent spawn port collision | v0.2.9 |
| F-013 | Mesh Bearer auth too restrictive | v0.2.9 |
| F-014 | /query lacks ?node= routing | v0.2.9 |

### Still Open (NOT fixed)

| ID | Severity | Title |
|----|----------|-------|
| R1-002 | HIGH | Stale bot processes cause port conflicts on daemon restart |
| R1-003 | MEDIUM | Daemon doesn't inherit .env (PARTIALLY fixed — .env parser added in v0.2.9) |
| R1-006 | P0 | `bot ls` no remote bots (CLI lacks --node) |
| R1-007 | P0 | `bot status` no remote syntax (@ rejected) |
| R1-010 | HIGH | Budget enforcement doesn't block (meter cost fixed, budget logic added in v0.2.9) |
| R1-011 | MEDIUM | CLI write commands blocked by daemon lock (PARTIALLY fixed for acl/totp/auth-config) |
| R1-013 | MEDIUM | --no-auth bot gives "Internal server error" |
| R1-014 | MEDIUM | ACL changes require daemon restart |
| R1-015 | MEDIUM | Default expose empty blocks queries |
| R1-016 | MEDIUM | MCP tools not available to bots |
| R1-018 | HIGH | sandbox-guard.sh syntax error |
| R1-019 | MEDIUM | bash-guard.sh blocks URLs as paths |
| R1-025 | HIGH | CLI write commands blocked (meter/budget/auth add) |
| R1-026 | MEDIUM | $env: auth profiles unquotable in CLI |
| R1-027 | MEDIUM | MCP config outputs Bun VFS path |
| R1-028 | LOW | bot find --tag local only |
| R1-029 | MEDIUM | MCP serve ignores MECHA_DIR |
| R1-030a | LOW | node health --json empty |
| R1-033 | P1 | Force stop during chat fails |
| R1-034 | P1 | Daemon registry desync |
| R1-035 | P1 | Workspace read API 404 |
| F-008 | MEDIUM | CLI bot ls/status/find lack --node |
| F-009 | LOW | /discover local only |
| F-010 | MEDIUM | Budget enforcement (needs re-verify) |
| F-011 | MEDIUM | Daemon silent crash during MCP testing |

---

## Round 3 Testing Matrix

### Priority Legend
- **V** = Verify fix (regression test for something fixed in v0.2.8/v0.2.9)
- **R** = Re-test open finding
- **N** = New test (not covered in rounds 1-2)

---

### Category 1: Bot Lifecycle (11 tests)

| # | Test | Type | Tests Fix | Machine | Command/Steps |
|---|------|------|-----------|---------|---------------|
| 3.1.1 | Daemon auto-loads .env | V | F-001 | linode02 | 1. Write `ANTHROPIC_API_KEY=...` to `~/.mecha/.env` 2. `mecha start -d --host 0.0.0.0` 3. `mecha bot spawn test-env ~/tmp` 4. `mecha bot chat test-env "say hello"` — should work without manual source |
| 3.1.2 | No spurious workspace warning | V | F-002 | linode02 | `mecha bot spawn alice ~/test-project` — no "Workspace not under home" warning |
| 3.1.3 | SIGKILL sets state to "error" | V | F-003/R1-012 | linode02 | 1. `mecha bot spawn crash-test ~/tmp` 2. `kill -9 <pid>` 3. `mecha bot status crash-test` — state should be "error", not "stopped" |
| 3.1.4 | Parallel spawn no port collision | V | F-012/R1-032 | linode02 | `for i in 1 2 3 4 5; do mecha bot spawn par-$i ~/tmp & done; wait` — all 5 should get unique ports |
| 3.1.5 | Restart no EADDRINUSE | V | R1-021 | linode02 | `mecha bot restart <running-bot>` — should succeed without port conflict |
| 3.1.6 | Restart-all no race | V | R1-021 | linode02 | `mecha bot restart-all` with 3+ bots — all should restart |
| 3.1.7 | Stale process cleanup on daemon restart | R | R1-002 | linode02 | 1. Start daemon + spawn 3 bots 2. `kill -9 <daemon-pid>` 3. `mecha start -d --host 0.0.0.0` 4. Verify old bots rediscovered OR new spawns don't conflict |
| 3.1.8 | Daemon fork guards PID | N | audit#4 | linode02 | Move mecha binary, `mecha start -d` with bad PATH — should error "Failed to fork", not write undefined PID |
| 3.1.9 | Force stop during active chat | R | R1-033 | linode02 | 1. Start long chat 2. `mecha bot stop <name> --force` — should stop cleanly |
| 3.1.10 | --no-auth bot error message | R | R1-013 | linode02 | `mecha bot spawn nokey ~/tmp --no-auth` then `mecha bot chat nokey "hello"` — should say "No API credentials" not "Internal server error" |
| 3.1.11 | Daemon PID file written correctly | N | - | linode02 | `mecha start -d --host 0.0.0.0` then `cat ~/.mecha/daemon.pid` — PID should match `pgrep -f mecha` |

---

### Category 2: Chat & Query (8 tests)

| # | Test | Type | Tests Fix | Machine | Command/Steps |
|---|------|------|-----------|---------|---------------|
| 3.2.1 | Dashboard admin query without X-Mecha-Source | V | F-005 | linode02 | `curl -X POST http://127.0.0.1:7660/bots/alice/query -H "Cookie: <session>" -d '{"message":"hello"}'` — should succeed (defaults to "admin") |
| 3.2.2 | ACL-denied query returns 403 | V | F-005 | linode02 | Query with source "stranger" and no ACL grant — should get 403 |
| 3.2.3 | Cross-node query via ?node= | V | F-014 | linode02 | `curl -X POST "http://127.0.0.1:7660/bots/remote-worker/query?node=spark01" -H "Cookie: <session>" -d '{"message":"ping"}'` — should proxy to spark01 |
| 3.2.4 | Cross-node query unknown node | V | F-014 | linode02 | `?node=nonexistent` — should return 404 "Node not found" |
| 3.2.5 | Query nonexistent bot (local) | N | - | linode02 | Query bot that doesn't exist — 404 "not found" |
| 3.2.6 | Query with ACL from remote source | N | - | linode02 | Source "coder@spark01" with ACL grant — should succeed |
| 3.2.7 | Budget-enforced query blocked | R | F-010/R1-010 | linode02 | 1. Set $0.01 daily budget 2. Send queries until over budget 3. Next query should be rejected (402 or similar) |
| 3.2.8 | Default expose blocks query | R | R1-015 | linode02 | Spawn bot without `--expose query`, attempt inter-bot query — should fail with clear "not exposed" error |

---

### Category 3: Auth & Security (10 tests)

| # | Test | Type | Tests Fix | Machine | Command/Steps |
|---|------|------|-----------|---------|---------------|
| 3.3.1 | ACL grant while daemon runs | V | F-004 | linode02 | `mecha acl grant coder alice query` — should succeed (no lock conflict) |
| 3.3.2 | ACL revoke while daemon runs | V | F-004 | linode02 | `mecha acl revoke coder alice query` — should succeed |
| 3.3.3 | TOTP setup while daemon runs | V | F-004 | linode02 | `mecha totp setup` — should succeed (no lock conflict) |
| 3.3.4 | Auth-config while daemon runs | V | F-004 | linode02 | `mecha auth-config` — should succeed |
| 3.3.5 | Bearer auth requires X-Mecha-Source | V | audit#1 | linode02 | `curl -H "Authorization: Bearer <mesh-key>" http://127.0.0.1:7660/bots` — should return 401 (no X-Mecha-Source) |
| 3.3.6 | Bearer auth with X-Mecha-Source on /bots | V | audit#1/F-013 | linode02 | Add X-Mecha-Source header — should succeed on /bots, /node/info, /discover |
| 3.3.7 | Plugin add while daemon runs | V | F-004 | linode02 | `mecha plugin add <path>` — should succeed (was previously locked) |
| 3.3.8 | ACL changes picked up by daemon | R | R1-014 | linode02 | 1. `mecha acl grant coder alice query` 2. Immediately query — does daemon see the new rule? |
| 3.3.9 | meter/budget CLI while daemon runs | R | R1-025 | linode02 | `mecha budget set --daily 10.00` then `mecha budget ls` — verify still locked or now unlocked |
| 3.3.10 | $env: auth profile quoting | R | R1-026 | linode02 | `mecha auth switch <bot> '$env:api-key'` — does shell quoting work? |

---

### Category 4: Mesh Networking & Multi-Machine (14 tests)

| # | Test | Type | Tests Fix | Machine | Command/Steps |
|---|------|------|-----------|---------|---------------|
| 3.4.1 | Node name correct in /mesh/nodes | V | F-007 | linode02 | `curl /mesh/nodes` — local node name should be "linode02" not "unknown" |
| 3.4.2 | Node name in handshake | V | F-007 | linode02 | `curl /discover/handshake` — should return correct nodeName |
| 3.4.3 | Remote bot spawn via API | V | F-013 | linode02→spark01 | `curl -X POST "http://127.0.0.1:7660/bots?node=spark01" -H "Authorization: Bearer <key>" -H "X-Mecha-Source: admin@linode02" -d '{"name":"remote-test","workspacePath":"/tmp"}'` — should succeed |
| 3.4.4 | Remote bot stop via API | V | F-013 | linode02→spark01 | `POST /bots/remote-worker/stop?node=spark01` with Bearer — should succeed |
| 3.4.5 | Remote sessions via API | V | F-013 | linode02→spark01 | `GET /bots/remote-worker/sessions?node=spark01` with Bearer — should succeed |
| 3.4.6 | Remote schedule add via API | V | F-013 | linode02→spark01 | `POST /bots/remote-worker/schedules?node=spark01` with Bearer — should succeed |
| 3.4.7 | Cross-node inter-bot query | V | F-014 | linode02→spark01 | `POST /bots/remote-worker/query?node=spark01` with session cookie — should proxy and return response |
| 3.4.8 | Bidirectional node registration | N | - | linode02↔spark01 | Register each node with the other, verify both `node ls` show the peer |
| 3.4.9 | CLI bot ls --node (if added) | R | R1-006/F-008 | linode02 | `mecha bot ls --node spark01` — if flag exists, verify remote bots listed |
| 3.4.10 | CLI bot status --node (if added) | R | R1-007/F-008 | linode02 | `mecha bot status remote-worker --node spark01` |
| 3.4.11 | Dashboard remote bot view | N | - | linode02 | Navigate to `/?node=spark01` in dashboard — verify remote bots displayed with correct node name |
| 3.4.12 | Auto-discovery between nodes | N | - | linode02↔spark01 | Set same `MECHA_CLUSTER_KEY` on both, verify auto-discovery handshake |
| 3.4.13 | Daemon registry sync with filesystem | R | R1-034 | linode02 | 1. Spawn via CLI 2. Check dashboard shows same state 3. Stop via API 4. Check `bot ls` agrees |
| 3.4.14 | /discover local + tag filter | R | F-009 | linode02 | `GET /discover?tag=code` — local bots filtered correctly |

---

### Category 5: Metering & Budgets (6 tests)

| # | Test | Type | Tests Fix | Machine | Command/Steps |
|---|------|------|-----------|---------|---------------|
| 3.5.1 | Meter records non-zero cost | V | R1-009 | linode02 | Chat with metered bot, `mecha cost` — cost should be > $0.00 |
| 3.5.2 | Budget auto-reload from disk | V | audit#2 | linode02 | 1. Set budget 2. Chat (allowed) 3. Lower budget below current spend 4. Wait 2s 5. Chat again — should be blocked |
| 3.5.3 | Budget daily enforcement | R | R1-010/F-010 | linode02 | Set $0.01 daily, ensure spend exceeds it, verify next request blocked |
| 3.5.4 | Budget monthly enforcement | R | - | linode02 | Set $0.50 monthly, verify enforcement |
| 3.5.5 | Concurrent budget check | N | audit#2 | linode02 | 3 simultaneous requests near budget limit — pending cost pre-accounting should prevent overspend |
| 3.5.6 | Meter survives daemon restart | R | - | linode02 | 1. Record costs 2. Restart daemon 3. `mecha cost` — totals preserved |

---

### Category 6: Sandbox & Hooks (5 tests)

| # | Test | Type | Tests Fix | Machine | Command/Steps |
|---|------|------|-----------|---------|---------------|
| 3.6.1 | sandbox-guard.sh syntax | R | R1-018 | linode02 | Spawn with `--sandbox auto`, inspect generated `sandbox-guard.sh` — verify no syntax errors |
| 3.6.2 | bash-guard.sh URL handling | R | R1-019 | linode02 | Bot attempts `curl https://httpbin.org/get` — should not be blocked as filesystem path |
| 3.6.3 | macOS sandbox profile | R | - | mac-mini | Spawn with `--sandbox auto` on macOS — verify Seatbelt profile generated |
| 3.6.4 | dangerouslySkipPermissions + sandbox | N | - | linode02 | `mecha bot spawn test ~/tmp --dangerously-skip-permissions --sandbox require` — should error (no bubblewrap) |
| 3.6.5 | Spawn with sandbox off explicit | N | - | linode02 | `mecha bot spawn test ~/tmp --sandbox off` — verify no hooks/guard generated |

---

### Category 7: MCP Server (5 tests)

| # | Test | Type | Tests Fix | Machine | Command/Steps |
|---|------|------|-----------|---------|---------------|
| 3.7.1 | MCP config real binary path | R | R1-027 | linode02 | `mecha mcp config` — verify path is real binary, not `/$bunfs/...` |
| 3.7.2 | MCP serve with MECHA_DIR | R | R1-029 | linode02 | `MECHA_DIR=~/.mecha mecha mcp serve --transport http --port 7680` — verify works |
| 3.7.3 | MCP query cross-node | N | F-014 | linode02 | `mecha_query` tool with `node` parameter — does it support cross-node? |
| 3.7.4 | Workspace read API | R | R1-035 | linode02 | `GET /bots/alice/workspace/README.md` — should return file content |
| 3.7.5 | MCP tools available to bots | R | R1-016 | linode02 | Spawn bot with `--mcp-config` pointing to mecha MCP, verify tools listed |

---

### Category 8: Dashboard & SPA (4 tests)

| # | Test | Type | Tests Fix | Machine | Command/Steps |
|---|------|------|-----------|---------|---------------|
| 3.8.1 | Node name in dashboard | V | F-007 | linode02 | Open dashboard — local node should show "linode02" not "unknown" |
| 3.8.2 | Remote bot management | V | F-013 | linode02 | Dashboard → click remote node → Stop/Start remote bot via UI |
| 3.8.3 | Terminal WebSocket | N | R1-030b | linode02 | Open bot terminal in dashboard — should connect and show Claude prompt |
| 3.8.4 | Settings page ACL/TOTP | V | F-004 | linode02 | Verify settings page links work while daemon runs |

---

### Category 9: Upgrade & Recovery (4 tests)

| # | Test | Type | Tests Fix | Machine | Command/Steps |
|---|------|------|-----------|---------|---------------|
| 3.9.1 | Upgrade v0.2.8 → v0.2.9 | N | - | linode02 | `brew upgrade mecha` — verify version, bots, sessions, TOTP preserved |
| 3.9.2 | Upgrade v0.2.8 → v0.2.9 | N | - | spark01 | Same as 3.9.1 on arm64 |
| 3.9.3 | Daemon crash recovery | R | F-011 | linode02 | Kill daemon, restart, verify bots rediscovered |
| 3.9.4 | ensureNodeName auto-init | V | audit#8 | fresh machine | Start without `node init` — should auto-generate node name from hostname |

---

## Summary

| Category | Verify Fix | Re-test Open | New | Total |
|----------|-----------|-------------|-----|-------|
| 1. Bot Lifecycle | 6 | 3 | 2 | 11 |
| 2. Chat & Query | 4 | 2 | 2 | 8 |
| 3. Auth & Security | 7 | 3 | 0 | 10 |
| 4. Mesh & Multi-Machine | 7 | 3 | 4 | 14 |
| 5. Metering & Budgets | 2 | 2 | 2 | 6 |
| 6. Sandbox & Hooks | 0 | 3 | 2 | 5 |
| 7. MCP Server | 0 | 4 | 1 | 5 |
| 8. Dashboard & SPA | 3 | 0 | 1 | 4 |
| 9. Upgrade & Recovery | 1 | 1 | 2 | 4 |
| **Total** | **30** | **21** | **16** | **67** |

### Execution Order (by priority)

1. **Upgrade first** (3.9.1, 3.9.2) — install v0.2.9 on all machines
2. **Verify critical fixes** (3.3.1-3.3.4, 3.1.1, 3.1.4, 3.4.3-3.4.7) — F-004, F-001, F-012, F-013, F-014
3. **Verify remaining fixes** (3.1.2-3.1.3, 3.2.1-3.2.4, 3.4.1-3.4.2, 3.5.1-3.5.2)
4. **Re-test open findings** (3.2.7-3.2.8, 3.3.8-3.3.10, 3.5.3, 3.6.1-3.6.2, 3.7.1-3.7.4)
5. **New tests** (3.1.8, 3.4.8, 3.4.11-3.4.12, 3.5.5, 3.8.3)

### Machines

| Machine | Primary Tests | Notes |
|---------|--------------|-------|
| linode02 (x64) | All categories | Primary test machine |
| spark01 (arm64) | 3.4.x (mesh target), 3.9.2 | Remote node for cross-machine tests |
| mac-mini (macOS arm64) | 3.6.3 (sandbox), 3.9.x | macOS-specific sandbox testing |
