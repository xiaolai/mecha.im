# 014: ACL Changes Require Daemon Restart

**Test:** 12.9/12.11 - Cross-node ACL
**Severity:** Medium
**Machine:** linode02 (100.100.1.9)

## Observed

ACL rules written to `acl.json` (either via `mecha acl grant` or direct file write) are not picked up by the running daemon. The ACL engine loads rules at startup and does not watch for changes.

Additionally, running `mecha acl grant` while the daemon is running often fails with "Another mecha CLI is already running" (finding 011), compounding the issue.

Workflow that fails:
1. Daemon running
2. `mecha acl grant agent@spark01-node query coder` -- may fail due to lock
3. Even if grant succeeds, the daemon's in-memory ACL is stale
4. Cross-node query still denied until daemon restart

## Expected

ACL changes should take effect without restarting the daemon. Either:
- The daemon should watch `acl.json` for changes
- The `acl grant` command should notify the daemon to reload
- The ACL engine should re-read from disk on each check (with caching)

## Workaround

Write `acl.json` before starting the daemon, or restart the daemon after ACL changes.

## Impact

Makes ACL management cumbersome in production. Users must restart the daemon (and all bots lose their state context) just to update permissions.
