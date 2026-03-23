# Finding 020: No OS-level sandbox isolation (no namespaces, no Seatbelt)

**Test:** 10.5, 10.6, 10.8
**Severity:** Medium
**Status:** Design gap

## Summary

The sandbox implementation is entirely hook-based (Claude Code PreToolUse hooks). There is no OS-level isolation:

- **Linux:** Bot processes share the same namespaces (mnt, pid, user) as the mecha daemon. No user namespace, mount namespace, or cgroup isolation.
- **macOS:** No `sandbox-exec` / Seatbelt profile is generated or applied. The `sandbox-profile.sbpl` file does not exist.

## Evidence

### Linux (spark01)
```
mecha ns: mnt:[4026531841] pid:[4026531836] user:[4026531837]
bot ns:   mnt:[4026531841] pid:[4026531836] user:[4026531837]
```
Identical namespace IDs -- no isolation.

### macOS (mac-mini)
```
$ ls ~/mecha-camp/sandbox-mac/.claude/sandbox-profile.sbpl
No such file or directory
```
No Seatbelt profile generated.

The source code (`packages/process/src/`) contains no references to `sandbox-exec`, `seatbelt`, or `sbpl`.

## Impact

The sandbox relies entirely on Claude Code hooks to intercept tool calls. A bot could bypass this by:
- Using a Bash command that the hook regex fails to parse
- Exploiting the syntax error in sandbox-guard.sh (Finding 018)

The hooks provide defense-in-depth but are not a true security boundary.

## Recommendation

Document that the current sandbox is "hooks-only" and does not provide OS-level isolation. Consider implementing actual namespace isolation on Linux and Seatbelt on macOS for `--sandbox require` mode.
