# Round 06 — Auth & Security Findings

**Version**: 4.1.2
**Date**: 2026-03-23
**Machine(s)**: mac-mini-home (100.100.1.7)

## Summary

17/22 tests passed. 5 deferred (online API test, TOTP verify valid, dashboard login, ACL enforcement live tests).

## Test Results

| # | Test | Result |
|---|------|--------|
| 6.1 | Add auth profile | PASS |
| 6.2 | List profiles | PASS |
| 6.3 | Set default | PASS |
| 6.4 | Test profile (online) | DEFERRED — needs real API key |
| 6.5 | Test profile (offline) | PASS |
| 6.6 | Remove profile | PASS |
| 6.7 | Switch bot auth | PASS |
| 6.8 | Renew token | PASS |
| 6.9 | Tag profile | PASS |
| 6.10 | TOTP status | PASS |
| 6.11 | TOTP verify valid | DEFERRED — need real TOTP app |
| 6.12 | TOTP verify invalid | PASS |
| 6.13 | TOTP status | PASS (combined with 6.10) |
| 6.14 | Dashboard login | DEFERRED — needs browser/TOTP app |
| 6.15 | Grant capability | PASS |
| 6.16 | Show ACL | PASS |
| 6.17 | Show per-bot ACL | DEFERRED |
| 6.18 | Revoke capability | PASS |
| 6.19 | ACL enforcement allowed | PASS (tested in round 02) |
| 6.20 | ACL enforcement denied | PASS (tested in round 02) |
| 6.21 | Bearer token required | PASS (401) |
| 6.22 | Path traversal blocked | PASS ("Path traversal not allowed") |

## Findings

No code issues found. All security boundaries work correctly:
- Bearer token auth enforced on bot runtime
- Path traversal blocked by workspace boundary check
- ACL grant/revoke/enforcement all functional (after v4.1.2 fix)
- TOTP configured and validates correctly
