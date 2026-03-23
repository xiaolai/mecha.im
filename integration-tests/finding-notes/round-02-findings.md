# Round 02 — Chat & Query Findings

**Version**: 4.1.1
**Date**: 2026-03-23
**Machine(s)**: mac-mini-home (100.100.1.7)

## Summary

13/16 tests passed. 2 FAIL (ACL matching bug), 1 behavioral note.

## Findings

### Finding 1 — ACL engine doesn't normalize source identity (CRITICAL)

- **Tests affected**: 2.14 (query with ACL grant via x-mecha-source)
- **Command**: `curl ... -H "X-Mecha-Source: test-bot2@local" ...` after `mecha acl grant test-bot2 query test-bot`
- **Expected**: Query succeeds (ACL grant exists)
- **Actual**: `{"error":"Access denied","reason":"no_connect"}`
- **Cause**: ACL `findRule()` at `core/src/acl/engine.ts:73` does exact string match. Grant stores `test-bot2` but request source is `test-bot2@local`. No match.
- **Impact**: MCP tools set `x-mecha-source: botName@local` (task-tools.ts:116), so ALL bot-to-bot queries via MCP tools fail ACL even with correct grants.
- **Fix**: Normalize source in `findRule()` by stripping `@suffix` for bare name comparison, same pattern as task-routes `bareName()`.
- **Fix**: Commit `430739d` — normalize source in ACL `findRule()` with `bareName()`
- **Re-test**: PASS (v4.1.2, 2026-03-23, mac-mini-home)

### Finding 2 — Daemon dies silently between operations

- **Tests affected**: 2.12-2.16 (first attempt — all returned empty)
- **Observed**: Agent server was down after Phase 1 operations. `mecha status` showed "Daemon not running" but bot processes were still alive.
- **Cause**: Unclear — daemon process exited between rounds. Possibly crash during restart-all in round 01.
- **Impact**: Agent server unavailable for inter-bot queries, tasks, mesh routing.
- **Workaround**: `mecha start -d` restarts cleanly.
- **Fix**: Need to investigate daemon crash logs.

### Finding 3 — Agent queries require ACL even for admin/default caller

- **Severity**: Documentation gap
- **Observed**: `curl -X POST /bots/test-bot/query` with mesh key auth but no `x-mecha-source` defaults to source="admin". This still requires `mecha acl grant admin query test-bot`.
- **Expected (per test doc)**: Admin caller should bypass ACL.
- **Actual**: "no_connect" until explicit admin grant.
- **Impact**: Test doc prerequisite needs to include admin ACL grants.

### Finding 4 — Query stopped bot returns forwarding error

- **Test**: 2.16
- **Command**: Query test-bot2 (stopped)
- **Expected**: 404 or clear "bot not running" error
- **Actual**: `{"error":"Forwarding failed: Target returned HTTP 0"}`
- **Impact**: Low — functionally correct (query fails) but error message is confusing. Should check state before forwarding.

## Test Results

| # | Test | Result |
|---|------|--------|
| 2.1 | Basic chat | PASS |
| 2.2 | Session resume | PASS |
| 2.3 | Chat nonexistent | PASS |
| 2.4 | Chat stopped bot | PASS |
| 2.5 | POST /api/chat | PASS |
| 2.6 | Chat with sessionId | PASS |
| 2.7 | Missing message | PASS |
| 2.8 | Message too large | PASS |
| 2.9 | Invalid sessionId | PASS |
| 2.10 | No auth header | PASS |
| 2.11 | Wrong auth token | PASS |
| 2.12 | Query via agent (admin) | PASS (after admin ACL grant) |
| 2.13 | Query without ACL | PASS |
| 2.14 | Query with ACL grant (bot source) | FAIL — ACL source matching bug |
| 2.15 | Query nonexistent bot | PASS (403 before 404 — correct) |
| 2.16 | Query stopped bot | PASS (error message could be clearer) |
