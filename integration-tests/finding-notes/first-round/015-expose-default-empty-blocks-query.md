# 015: Default Bot Expose is Empty - Blocks All Cross-Node Queries

**Test:** 12.9 - Chat with remote bot
**Severity:** Medium
**Machine:** linode02 (100.100.1.9)

## Observed

Even with correct ACL rules granting `query` capability, cross-node queries are denied with "Access denied" because the target bot's `config.json` has no `expose` field, and the default is an empty array `[]`.

The ACL engine performs two checks:
1. Connect rule exists (ACL grant) -- PASS
2. Target exposes the capability -- FAIL (empty expose)

```json
// coder/config.json - missing expose field
{
  "configVersion": 1,
  "port": 7701,
  "token": "mecha_...",
  "workspace": "/home/joker/mecha-camp/coder"
}
```

## Expected

Either:
- `mecha bot spawn` should include a default `expose` value (at least `["query"]`)
- The `--expose` flag documentation should clearly state this is required for cross-node communication
- The ACL deny error message should distinguish between "no connect rule" and "capability not exposed" to help users diagnose the issue

## Workaround

Manually add `"expose": ["query"]` to the bot's `config.json` and restart the daemon.

Or spawn with: `mecha bot spawn coder ~/project --expose query`

## Impact

First-time mesh setup is confusing. The error "Access denied: X cannot query Y" looks like an ACL issue, but the actual problem is the target bot's expose config. Users will repeatedly adjust ACL rules without realizing the expose field is the blocker.
