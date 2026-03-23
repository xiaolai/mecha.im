# Round 11 Testing Matrix — v0.2.16 (Full Regression)

**Target version**: v0.2.16 (npm distribution, all bugs fixed)
**Focus**: Full regression across all 13 categories, incorporating Codex QA review
**Machines**: local (macOS arm64), linode02 (Linux x64), spark01 (Linux arm64)
**Distribution**: scp tarball + `npm install -g mecha.im-0.2.16.tgz`

---

## Phase 0: Package Smoke + Migration Survival (8 tests)

Gate phase — if these fail, stop and fix before proceeding.

| ID | Test | Machine | Priority |
|----|------|---------|----------|
| NPM-01 | `pnpm build:publish` succeeds, all 4 artifacts present | local | P0 |
| NPM-02 | `npm install -g` + `mecha --version` works | all 3 | P0 |
| RT-01 | Bot spawn uses `node .../runtime.js` (not binary) | local | P0 |
| SPA-01 | `curl http://localhost:7660/` returns 200 with SPA HTML | local | P0 |
| 13.4 | Bot configs survive (pre-existing bots listed after install) | local | P0 |
| 13.5 | Sessions survive (previous sessions still accessible) | local | P0 |
| 13.7 | Node registry preserved after install | local | P0 |
| SYS-01 | systemPrompt works (spawn with `--system-prompt`, verify behavior) | local | P0 |

## Phase 1: Sandbox (10) — 5 tests

Moved early per Codex advice — chat, schedules, and mesh depend on sandbox correctness.

| ID | Test | Machine | Priority |
|----|------|---------|----------|
| 10.1 | Spawn with auto sandbox → chat works | local (macOS) | P0 |
| 10.3 | Spawn with sandbox off | local | P1 |
| 10.5 | File read restriction — bot blocked from reading outside workspace | local (macOS) | P0 |
| 10.7 | Sandbox profile generated (sandbox.sbpl exists) | local | P1 |
| 10.10 | `--dangerously-skip-permissions --sandbox off` → error | local | P0 |

## Phase 2: Bot Lifecycle (01) — 15 tests

Run on local machine with temporary test bots.

| ID | Test | Priority |
|----|------|----------|
| 1.1 | Spawn with defaults | P0 |
| 1.2 | Spawn with explicit port | P0 |
| 1.3 | Spawn with tags | P1 |
| 1.4 | Spawn with expose | P1 |
| 1.5 | Spawn duplicate name → error | P0 |
| 1.6 | Spawn invalid name → error | P0 |
| 1.8 | Spawn with model override | P1 |
| 1.9 | List bots | P0 |
| 1.10 | Bot status | P0 |
| 1.13 | Graceful stop | P0 |
| 1.14 | Force kill | P0 |
| 1.15 | Stop already stopped → error/no-op | P0 |
| 1.16 | Stop-all | P0 |
| 1.17 | Restart running bot | P0 |
| 1.20 | Remove stopped bot | P0 |

## Phase 3: Chat & Query (02) + Sessions (03) — combined flow, 16 tests

Chain tests using the same session for efficiency.

**Chat:**

| ID | Test | Priority |
|----|------|----------|
| 2.1 | CLI basic chat | P0 |
| 2.5 | HTTP POST /api/chat → response with sessionId | P0 |
| 2.6 | Chat with same sessionId → session resumed | P0 |
| 2.2 | Session resume retains context | P0 |
| 2.7 | Missing message → 400 | P0 |
| 2.9 | Invalid sessionId type → 400 | P1 |
| 2.10 | No auth → 401 | P0 |
| 2.11 | Wrong token → 401 | P0 |

**Inter-bot routing:**

| ID | Test | Priority |
|----|------|----------|
| 2.12 | Inter-bot query via agent (with ACL) | P0 |
| 2.13 | Query without ACL → 403 | P0 |
| 2.15 | Query nonexistent bot → 404 | P0 |

**Sessions (using sessions created by chat above):**

| ID | Test | Priority |
|----|------|----------|
| 3.1 | CLI sessions list | P0 |
| 3.4 | GET /api/sessions | P0 |
| 3.5 | GET /api/sessions/:id | P0 |
| 3.6 | GET nonexistent session → 404 | P1 |
| 3.7 | DELETE session | P1 |

## Phase 4: Scheduling (04) — single fixture, 10 tests

All tests use one schedule on one bot.

| ID | Test | Priority |
|----|------|----------|
| 4.1 | Add schedule | P0 |
| 4.2 | List schedules | P0 |
| 4.3 | Add duplicate → error | P0 |
| 4.7 | Pause schedule | P0 |
| 4.8 | Resume schedule | P0 |
| 4.9 | Pause all (add second schedule first) | P1 |
| 4.10 | Resume all | P1 |
| 4.12 | Manual trigger (run) | P0 |
| 4.14 | View history | P0 |
| 4.5 | Remove schedule | P0 |

## Phase 5: Auth & Security (06) — 12 tests

| ID | Test | Priority |
|----|------|----------|
| 6.1 | Add auth profile | P0 |
| 6.2 | List profiles | P0 |
| 6.4 | Test profile (online) | P0 |
| 6.6 | Remove profile | P0 |
| 6.10 | TOTP setup (--force) | P0 |
| 6.11 | TOTP verify valid | P0 |
| 6.12 | TOTP verify invalid | P0 |
| 6.13 | TOTP status | P1 |
| 6.15 | ACL grant | P0 |
| 6.16 | ACL show | P0 |
| 6.18 | ACL revoke + verify denied | P0 |
| 6.21 | Bearer token required → 401 | P0 |

## Phase 6: Metering & Budgets (07) — 7 tests

| ID | Test | Priority |
|----|------|----------|
| 7.1 | Meter status | P0 |
| 7.5 | View all costs | P0 |
| 7.6 | View per-bot cost | P0 |
| 7.7 | Cost after chat (compare before/after) | P0 |
| 7.9 | Set daily budget | P0 |
| 7.11 | List budgets | P0 |
| 7.13 | Budget enforcement — set $0.001, chat, verify blocked | P0 |

## Phase 7: Failure & Recovery (11) — 8 tests

| ID | Test | Priority |
|----|------|----------|
| 11.1 | Bot crash (kill -9) → error state | P0 |
| 11.2 | Start after crash | P0 |
| 11.3 | Daemon crash → bots survive | P0 |
| 11.4 | Daemon restart rediscovers bots | P0 |
| 11.6 | Port in use → next port allocated | P0 |
| 11.8 | Corrupt config.json → graceful error | P0 |
| 11.9 | Missing state.json → treated as stopped | P0 |
| 11.15 | Simultaneous spawn (5 bots) | P1 |

## Phase 8: MCP Server (08) — 4 tests

Automatable subset via HTTP JSON-RPC.

| ID | Test | Machine | Priority |
|----|------|---------|----------|
| 8.2 | Start HTTP transport, verify listening | local | P0 |
| 8.5 | mecha_list_bots via JSON-RPC | local | P0 |
| 8.12 | Workspace path traversal → blocked | local | P0 |
| 8.15 | mecha_query via MCP → chat response | local | P0 |

## Phase 9: Dashboard SPA (09) — 3 tests

Minimal browser-automatable tests via curl + Playwright if available.

| ID | Test | Machine | Priority |
|----|------|---------|----------|
| 9.1 | Dashboard login with TOTP | local | P0 |
| 9.2 | Invalid TOTP → rejected | local | P0 |
| 9.4 | Bot list page renders (HTML contains bot names) | local | P1 |

## Phase 10: Multi-Machine (12) — 14 tests

Run across all 3 machines. Reuses existing mesh + bots.

| ID | Test | Link | Priority |
|----|------|------|----------|
| 12.3 | Three-node mesh verified | all | P0 |
| 12.4 | Ping latency all links | all | P0 |
| 12.5 | List remote bots from local | local→both | P0 |
| 12.6 | Remote bot status | local→linode02 | P0 |
| 12.8 | Stop remote bot + restart | local→linode02 | P1 |
| 12.9 | Chat with remote bot | local→linode02 | P0 |
| 12.10 | Inter-bot cross-node query | local→spark01 | P0 |
| 12.11 | ACL enforcement across nodes (grant + deny) | local→linode02 | P0 |
| 12.12 | List remote sessions | local→linode02 | P1 |
| 12.13 | View remote session detail | local→linode02 | P1 |
| 12.14 | Add schedule to remote bot | local→linode02 | P1 |
| 12.15 | Run remote schedule | local→linode02 | P1 |
| X-01 | linode02→spark01 cross-node query | linode02→spark01 | P0 |
| X-02 | spark01→local cross-node query | spark01→local | P0 |

---

## Summary

| Phase | Category | Tests | P0 | P1 |
|-------|----------|-------|----|----|
| 0 | Package Smoke + Migration | 8 | 8 | 0 |
| 1 | Sandbox | 5 | 3 | 2 |
| 2 | Bot Lifecycle | 15 | 11 | 4 |
| 3 | Chat + Sessions (combined) | 16 | 12 | 4 |
| 4 | Scheduling | 10 | 7 | 3 |
| 5 | Auth & Security | 12 | 10 | 2 |
| 6 | Metering & Budgets | 7 | 7 | 0 |
| 7 | Failure & Recovery | 8 | 7 | 1 |
| 8 | MCP Server | 4 | 4 | 0 |
| 9 | Dashboard SPA | 3 | 2 | 1 |
| 10 | Multi-Machine | 14 | 9 | 5 |
| **Total** | | **102** | **80** | **22** |

## Parallelization Plan

| local (macOS) | linode02 (Linux x64) | spark01 (Linux arm64) |
|---------------|---------------------|----------------------|
| Phase 0-7 (sequential) | Wait for Phase 0 pass | Wait for Phase 0 pass |
| Phase 8-9 | Phase 10 remote targets | Phase 10 remote targets |
| Phase 10 (orchestrator) | Respond to cross-node tests | Respond to cross-node tests |

## Critical 10 (minimum viable release test)

Per Codex QA review, if time is limited run only these:

1. **13.4** Bot configs survive npm install
2. **13.5** Sessions survive npm install
3. **12.3** Three-node mesh works
4. **12.10** Inter-bot cross-node query
5. **12.11** ACL across nodes
6. **10.1** macOS sandbox + chat works
7. **10.5** Sandbox file read restriction
8. **8.15** mecha_query via MCP
9. **9.1** Dashboard TOTP login
10. **7.13** Budget enforcement

## Success Criteria

- All 80 P0 tests PASS
- No new CRITICAL or HIGH findings
- All 3 cross-node link paths verified (local↔linode02, local↔spark01, linode02↔spark01)
- Sandbox chat works on macOS (R9-001 fix confirmed)
- systemPrompt works (R7-002 fix confirmed)
- Budget enforcement proven (R2 gap closed)
