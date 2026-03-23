# Finding 019: bash-guard.sh blocks URLs as filesystem paths

**Test:** 10.6 (Network allowed in sandbox)
**Severity:** Medium
**Status:** Bug

## Summary

The `bash-guard.sh` hook script extracts path-like strings from bash commands using a regex, but this regex also matches URLs. When a bot runs `curl https://httpbin.org/get`, the guard extracts `//httpbin.org/get` as a path and blocks it as "outside sandbox."

## Observed Behavior

```
$ echo '{"tool_name":"Bash","tool_input":{"command":"curl -s https://httpbin.org/get"}}' | bash bash-guard.sh
BLOCKED: //httpbin.org/get is outside sandbox
exit: 2
```

## Expected Behavior

Network requests (curl, wget, etc.) should be allowed. The hook should only block filesystem path arguments, not URL paths.

## Root Cause

The path extraction regex in `bash-guard.sh`:
```bash
grep -oE '((~|/|\.\./|\./)([^ ;"'"'"'|&>]*))'
```

This matches `//httpbin.org/get` from `https://httpbin.org/get` because `//` starts with `/`.

## Suggested Fix

Either:
1. Skip strings that match URL patterns (`https?://`, `ftp://`, etc.)
2. Only extract paths from known filesystem commands, not from all arguments
3. Add an allowlist for `://` patterns

## File

`/Users/joker/github/xiaolai/myprojects/mecha.im/packages/process/src/hook-scripts.ts` (bashGuard template)
