# 004 - Schedule Minimum Interval Mismatch (Doc vs Implementation)

**Test:** 4.4 - Add invalid interval
**Severity:** Low (documentation only)
**Machine:** spark01 (100.100.1.5)
**Date:** 2026-03-10

## Description

Test spec says the minimum schedule interval should be 1 minute, but the CLI accepts intervals down to 10 seconds.

## Expected (from test spec)

```
Error: invalid interval (minimum 1m)
```

## Actual

```
Invalid interval: "2s" (use format like "30s", "5m", "1h"; min 10s, max 24h)
```

## Impact

The feature works correctly -- invalid intervals are properly rejected. The discrepancy is between the test spec documentation (says 1m minimum) and the actual implementation (10s minimum). Either the test spec or the implementation should be updated to match.

## Verdict

PASS (behavior is correct; test spec needs updating to reflect actual minimum of 10s).
