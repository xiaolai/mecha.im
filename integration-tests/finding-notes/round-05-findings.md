# Round 05 — Mesh Networking Findings

**Version**: 4.1.2
**Date**: 2026-03-23
**Machine(s)**: mac-mini-home (100.100.1.7), linode02 (100.100.1.9), spark01 (100.100.1.5)

## Summary

8/20 tests passed. 4 FAIL (missing routes), 8 deferred (invite flow, API, discovery).

## Test Results

| # | Test | Result |
|---|------|--------|
| 5.1 | Initialize node | PASS |
| 5.2 | Node info | PASS |
| 5.3 | Add remote node | PASS |
| 5.4 | List nodes | PASS |
| 5.5 | Remove node | PASS |
| 5.6 | Add duplicate | PASS |
| 5.7 | Ping remote node | PASS (765ms to linode02) |
| 5.8 | Ping unreachable | PASS |
| 5.9 | Node health | PASS (both nodes reachable) |
| 5.10 | Node health specific | DEFERRED |
| 5.11 | List remote bots (--mesh) | FAIL — GET /bots route not implemented on agent |
| 5.12 | Remote bot status | FAIL — depends on 5.11 |
| 5.13 | Find by tag across nodes | FAIL — depends on 5.11 |
| 5.14 | Discover API | FAIL — GET /discover route not implemented |
| 5.15-5.17 | Invite flow | DEFERRED |
| 5.18-5.20 | Mesh API | DEFERRED |

## Findings

### Finding 1 — GET /bots route missing from agent server (HIGH)

- **Tests affected**: 5.11, 5.12, 5.13, 5.14
- **Code**: `bot-ls.ts:18` calls `GET /bots` on remote nodes
- **Actual**: 404 — route not registered in agent server
- **Impact**: `mecha bot ls --mesh` silently returns empty for remote nodes
- **Fix**: Need to add `GET /bots` route to agent server that returns local bot list
- **Re-test**: pending

### Finding 2 — GET /discover route missing (MEDIUM)

- **Test**: 5.14
- **Actual**: 404 — route not registered
- **Impact**: No programmatic way to discover bots across mesh
- **Fix**: Implement discover route or document as not-yet-available

### Note — All machines share same TOTP secret

All 3 machines derive identical mesh key from the same TOTP secret. This simplifies setup but means any machine can authenticate to any other. Expected for single-user deployment.
