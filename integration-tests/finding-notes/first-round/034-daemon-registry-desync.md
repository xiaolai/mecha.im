# 034 - Daemon Registry Desync with CLI/Filesystem

**Test:** Multiple (11.15, 11.16, N3, 9.12)
**Machine:** spark01 (100.100.1.5)
**Severity:** P1

## Observed

The daemon's in-memory bot registry diverges from the CLI's filesystem-based view:

1. `mecha status` (reads daemon memory) shows bots that were already `remove`d via CLI.
2. `mecha bot ls` (reads filesystem) shows the correct state.
3. `bot remove <name>` returns "not found" for bots that exist on filesystem but not in daemon registry.
4. `node ping <name>` returns "not found" for nodes that exist in `nodes.json` but were added before the current daemon started.

Example after removing par-* bots:
- `mecha bot ls`: shows only `coder`
- `mecha status`: shows `sandbox-off-test`, `ns-test`, `exhaust-test`, `port-test-1`, `tagged`, `model-bot`, `exposed`, `no-auth-bot`, `fresh-bot`, `coder`

## Root Cause

The daemon maintains its own in-memory registry that is not synchronized with filesystem state changes made by the CLI. The CLI writes to filesystem, the daemon reads its own memory. Neither notifies the other of changes.

## Impact

- Stale bot entries in dashboard (reads from daemon API)
- `bot remove` fails for bots the daemon doesn't know about
- `node ping` fails for nodes added before daemon restart
- Confusing inconsistency between `mecha status` and `mecha bot ls`

## Fix

Either:
1. Make the daemon the single source of truth (CLI routes all operations through daemon API)
2. Make the daemon watch the filesystem for changes (inotify/fswatch)
3. Invalidate daemon cache on CLI write operations
