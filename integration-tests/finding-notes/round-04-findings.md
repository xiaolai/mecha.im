# Round 04 — Scheduling Findings

**Version**: 4.1.2
**Date**: 2026-03-23
**Machine(s)**: mac-mini-home (100.100.1.7)

## Summary

15/18 tests passed. 3 deferred (HTTP API tests).

## Test Results

| # | Test | Result |
|---|------|--------|
| 4.1-4.6 | Schedule CRUD | PASS |
| 4.7-4.11 | Schedule control | PASS |
| 4.12-4.15 | Schedule execution + history | PASS |
| 4.16-4.18 | HTTP API | DEFERRED |

## Findings

### Finding 1 — Min interval is 10s, not 1m as test doc states

- **Severity**: Low (doc fix)
- **Test**: 4.4
- **Expected (per doc)**: "minimum 1m"
- **Actual**: Accepts `--every 10s` and above. Error says "min 10s, max 24h"
- **Impact**: Test doc should be updated to reflect actual minimum.
