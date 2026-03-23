# Finding 018: sandbox-guard.sh has syntax error on all platforms

**Test:** 10.5, 10.8 (sandbox file isolation)
**Severity:** High
**Status:** Bug

## Summary

The generated `sandbox-guard.sh` hook script has a bash syntax error on line 16 that causes it to always exit 2 (deny), even for valid workspace paths. This means the sandbox hook is overly restrictive -- it blocks ALL file operations, including those inside the bot's own workspace.

## Root Cause

In `packages/process/src/hook-scripts.ts` line 51, the `RESOLVED` variable assignment uses an `||` fallback that has an unquoted `$(basename ...)` outside the command substitution:

```bash
RESOLVED=$(realpath -m "$TARGET" 2>/dev/null || (cd "$(dirname "$TARGET")" 2>/dev/null && pwd)/$(basename "$TARGET"))
```

The `)/$(basename "$TARGET")` part causes a bash parse error because `)` closes the outer `$()` prematurely, and the `/$(basename ...)` is dangling.

## Observed Behavior

```
$ echo '{"tool_name":"Read","tool_input":{"file_path":"/home/joker/mecha-camp/sandbox-auto-ws/test.txt"}}' | bash sandbox-guard.sh
sandbox-guard.sh: line 16: syntax error near unexpected token `/$(basename "$TARGET")'
exit: 2
```

Even files **inside** the workspace are blocked.

## Expected Behavior

Files inside `MECHA_SANDBOX_ROOT` or `MECHA_WORKSPACE` should be allowed (exit 0). Files outside should be blocked (exit 2).

## Fix

Wrap the fallback in a proper subshell or use a separate variable:

```bash
RESOLVED=$(realpath -m "$TARGET" 2>/dev/null) || RESOLVED="$(cd "$(dirname "$TARGET")" 2>/dev/null && pwd)/$(basename "$TARGET")"
```

## Affected Platforms

Both Linux and macOS -- the syntax error occurs in bash on all platforms.

## File

`/Users/joker/github/xiaolai/myprojects/mecha.im/packages/process/src/hook-scripts.ts` line 51
