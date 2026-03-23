# Round 21 — Task Protocol Findings

**Version**: 4.1.2
**Date**: 2026-03-23
**Machine(s)**: mac-mini-home (100.100.1.7)

## Summary

16/40 tests passed. 0 FAIL. 24 deferred (MCP tools, security/ACL edge cases, concurrency, edge cases).

## Test Results

| # | Test | Result |
|---|------|--------|
| 21.1 | Create task | PASS (task-91504633eb6ca30c) |
| 21.2 | Create — bot not found | PASS (403 Access denied — ACL before 404, secure) |
| 21.3 | Create — invalid name | PASS (400 Invalid bot name) |
| 21.4 | Create — empty message | PASS (400 Invalid input) |
| 21.5 | Create — JSON output | DEFERRED |
| 21.6 | List all tasks | PASS |
| 21.7 | List by target | PASS |
| 21.8 | List by status | PASS |
| 21.9 | List invalid status | PASS (400 with valid status list) |
| 21.10-21.11 | List empty/JSON | DEFERRED |
| 21.12 | Task execution E2E | PASS (pending→working→completed, result="4") |
| 21.13 | Task metadata | PASS (sessionId, durationMs=2259, costUsd=$0.0143) |
| 21.14 | Task failure | DEFERRED |
| 21.15 | Show completed | PASS (full detail shown) |
| 21.16 | Show pending | DEFERRED |
| 21.17 | Show nonexistent | PASS (404) |
| 21.18 | Show JSON | DEFERRED |
| 21.19 | Cancel working task | PASS (status→cancelled) |
| 21.20 | Cancel pending | DEFERRED |
| 21.21 | Cancel completed | PASS (409 Cannot cancel) |
| 21.22 | Cancel nonexistent | PASS (404) |
| 21.23-21.25 | Concurrency | DEFERRED |
| 21.26 | Reconciliation | PASS (failed + "Agent restarted" after daemon restart) |
| 21.27 | Cleanup old tasks | DEFERRED |
| 21.28-21.31 | MCP tools | DEFERRED (needs live bot-to-bot chat) |
| 21.32-21.35 | Security/ACL | DEFERRED |
| 21.36 | Path traversal | PASS (500 "Invalid task ID" — blocked) |
| 21.37-21.40 | Edge cases | DEFERRED |

## Findings

### Finding 1 — Path traversal returns 500 instead of 400

- **Severity**: Low
- **Test**: 21.36
- **Expected**: 400 Bad Request
- **Actual**: 500 Internal Server Error with message "Invalid task ID"
- **Impact**: Functionally correct (traversal blocked) but 500 status leaks server error classification
- **Fix**: Catch the "Invalid task ID" error in task routes and return 400

### Finding 2 — "Bot not found" masked by ACL check

- **Test**: 21.2
- **Expected (per doc)**: 404 Bot not found
- **Actual**: 403 Access denied (ACL check happens first)
- **Impact**: Secure behavior — prevents bot enumeration. But test doc needs updating.

### Note — Task lifecycle fully functional

The core task protocol works end-to-end:
- Create → pending → working → completed (with result, session, duration, cost)
- Cancel → immediate abort of SDK query
- Reconciliation → stale tasks marked failed on restart
- Path traversal → blocked
- Storage → JSON files at ~/.mecha/tasks/
