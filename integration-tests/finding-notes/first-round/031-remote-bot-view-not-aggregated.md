# 031 - Remote Bot View Not Aggregated in API

**Test:** 9.12 - Remote bot view
**Machine:** spark01 (100.100.1.5)
**Severity:** P1

## Observed

1. `GET /bots/coder@mac-mini` returns `{"error":"Not found"}`.
2. `GET /bots?include=remote` returns only local bots — no remote bots from registered mesh nodes.
3. `bot find` CLI command also only returns local bots.

## Expected

The API should aggregate bot listings across mesh nodes, or at minimum support the `<bot>@<node>` syntax for fetching a specific remote bot's status.

## Impact

Dashboard cannot display remote bots. The SPA has no way to show a unified mesh view.

## Related

- finding-006 (bot ls no remote bots)
- finding-007 (bot status no remote syntax)
