# Finding 005: `bot status` does not support remote bot addressing

**Test:** 5.12 - Remote bot status
**Severity:** P0 FAIL
**Machines:** spark01 (verified), all machines affected

## Problem

`mecha bot status coder@linode02` fails with:

```
Invalid name: "coder@linode02" (must be lowercase, alphanumeric, hyphens)
```

The CLI bot status command validates the bot name against `isValidName()` which only allows lowercase alphanumeric characters and hyphens. The `name@node` addressing syntax used for inter-bot routing is not supported in the CLI.

## Root Cause

`packages/cli/src/commands/bot-status.ts` (or the underlying status lookup) uses name validation that rejects the `@` character. The MCP server supports `name@node` addressing (via `mecha_bot_status` tool in `packages/mcp-server/src/tools/discovery.ts`), but the CLI does not.

## Expected Behavior

`mecha bot status coder@linode02` should resolve the remote node, fetch the bot's status from it, and display it locally.

## Workaround

SSH into the remote machine and run `mecha bot status coder` locally, or use the MCP `mecha_bot_status` tool with a `name@node` target.
