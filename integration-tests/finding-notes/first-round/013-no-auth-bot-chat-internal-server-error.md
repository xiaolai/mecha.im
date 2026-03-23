# 013: Missing API Key Returns "Internal server error" Instead of Clear Message

**Test:** 11.13/11.14 - API key errors
**Severity:** Medium
**Machine:** spark01 (100.100.1.5)

## Observed

When a bot is spawned with `--no-auth` (no Anthropic API key), chatting returns a generic "Internal server error" with exit code 2.

```
$ mecha bot spawn badkey-test ~/mecha-camp/coder --no-auth
Spawned badkey-test on port 7701

$ mecha bot chat badkey-test "Say hi"
Internal server error
EXIT: 2
```

## Expected

A clear error message indicating the API key is missing or invalid, such as:
- "No API key configured for this bot"
- "Authentication failed: invalid or missing Anthropic API key"

## Impact

Users spawning bots without proper API credentials get an unhelpful error message that doesn't guide them toward the fix. The generic "Internal server error" could be caused by many things, making debugging difficult.

## Root Cause

The SDK `query()` call fails without credentials but the error is not properly surfaced through the `/api/chat` response path.
