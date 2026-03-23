# Finding 004: `bot ls` does not show remote bots

**Test:** 5.11 - List remote bots (local + remote)
**Severity:** P0 FAIL
**Machines:** spark01 (verified), all machines affected

## Problem

`mecha bot ls` only shows local bots. Even with remote nodes registered (via `mecha node add`), the `bot ls` command does not fetch or display bots from remote nodes.

## Root Cause

`packages/cli/src/commands/bot-ls.ts` calls `botFind(deps.mechaDir, deps.processManager, {})` which only scans local bot directories. There is no code path to query remote nodes for their bots.

The MCP server has `mecha_list_bots` tool that supports remote node querying (in `packages/mcp-server/src/tools/discovery.ts`), but the CLI `bot ls` command does not use this logic.

## Expected Behavior

With remote nodes registered, `mecha bot ls` should show both local and remote bots, ideally with a node indicator (e.g., `coder@linode02`).

## Actual Output

```
Name   State    Port  PID     Tags
-----  -------  ----  ------  ----
coder  running  7700  702498  -
```

Only local bots shown, no remote bots.

## Workaround

Use the `/discover` API endpoint with session auth to see local bots, or `/mesh/nodes` to see nodes with bot counts.
