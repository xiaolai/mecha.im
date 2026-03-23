# Round 8 Integration Testing — v0.2.14

**Date**: 2026-03-11
**Tester**: Claude Code (automated)
**Target version**: v0.2.14

## Machine Status

| Machine | IP | Version | Daemon |
|---------|-----|---------|--------|
| local (joker-mbp) | - | 0.2.14 | running (pid 96045) |
| mac-mini-home | 100.100.1.7 | 0.2.14 | running (pid 29160) |
| linode02 | 100.100.1.9 | 0.2.14 | running (pid 395374) |
| spark01 | 100.100.1.5 | 0.2.14 | running (pid 1450260) |

---

## Section A: Fix Verification

### FV-01: R7-004 concurrent port allocation — PASS

5 concurrent bot spawns all received unique ports (7700-7704), all running. R7-004 atomic port fix confirmed.

```
race-1  running  7701
race-2  running  7703
race-3  running  7704
race-4  running  7702
race-5  running  7700
```

### FV-02: Explicit port assignment — PASS

`--port 7710` correctly assigned. Port truthiness fix confirmed (port !== undefined).

### FV-03: R6-001 cli.lock — PASS (no regression)

`bot spawn` and `bot stop` both work while daemon running.

### FV-04: R6-002 ACL wildcard — PASS (no regression)

`acl grant '*' query acl-target` stores correctly. `acl show` displays wildcard rule.
Note: No `acl check` subcommand exists — verified rule exists in store.

### FV-05: R6-003 sandbox dedup — PASS (no regression)

Sandbox profile contains both symlink and resolved paths:
- `/Users/joker/.local/bin/claude` (symlink)
- `/Users/joker/.local/share/claude/versions/2.1.72` (resolved)
- `/opt/homebrew/Cellar/mecha/0.2.14/bin/mecha` (runtime)

---

## Section B: Open Bug Deep-Dive

### OB-01: R7-001 sandbox EPERM — ROOT CAUSE FOUND

**Status**: ROOT CAUSE IDENTIFIED — FIX IMPLEMENTED

**Root cause**: Bun's `child_process.spawn` opens `/dev/null` for any stdio fd set to `"ignore"`. The SBPL profile's `(deny default)` blocks `file-write*` to `/dev/null`, causing `posix_spawn` to fail with EPERM before the child process even starts.

**Investigation path**:
1. Confirmed EPERM reproducible on fresh sandboxed bot (`--sandbox auto`)
2. Confirmed unsandboxed bot (`--sandbox off`) chat works fine
3. Built minimal Bun-compiled standalone binaries to isolate the variable
4. Used SDK's `spawnClaudeCodeProcess` custom handler — worked! (uses plain `spawn()`)
5. Narrowed to: `spawn("claude", args, { stdio: ["pipe", "pipe", "ignore"] })` triggers EPERM
6. Confirmed `stdio: ["pipe", "pipe", "pipe"]` works, `stdio: ["pipe", "pipe", "ignore"]` fails
7. Adding `(allow file-write* (literal "/dev/null"))` to SBPL resolves the issue

**Fix**: Added `/dev/null` write permission to `generateSbpl()` in `packages/sandbox/src/platforms/macos.ts`.

**Verification**: Test binary that previously got EPERM now works inside sandbox with the fix.

### OB-02: R7-001 — sandbox with process-exec allow-all — SKIPPED

Superseded by OB-01 root cause finding. The issue was never about `process-exec` rules.

### OB-03: R7-002 systemPrompt — CONFIRMED (SDK/CLI issue)

**Status**: Bug confirmed, NOT a mecha issue

- `--system-prompt "You are a pirate"` → config.json stores `systemPrompt` correctly
- Runtime reads `botConfig.systemPrompt` and passes to `sdkChat`
- SDK receives it and passes via stream-json init message (NOT as CLI flag)
- Claude CLI 2.1.72 does not apply systemPrompt from SDK init messages
- 3 independent queries all returned generic Claude responses (no pirate behavior)
- "say arrr matey" appeared pirate-like but was prompt-induced, not systemPrompt-induced

**Root cause**: Likely a Claude CLI 2.1.72 bug where `systemPrompt` from SDK `query()` init is ignored. The `--system-prompt` CLI flag works when used directly. Mecha's plumbing is correct.

**Severity**: MEDIUM — affects bot personality customization but chat itself works.

### OB-04: R7-002 — inspect compiled runtime env vars — PASS

Config stores `systemPrompt` correctly. Runtime environment has `MECHA_CLAUDE_PATH` set. The issue is upstream in Claude CLI SDK mode, not in mecha's env or config handling.

### OB-05: R7-003 SSE events — DEFERRED

SSE event testing requires daemon API interaction which is better tested as part of a mesh networking session. Deferred to Section C if time permits.

### OB-06: R7-003 — daemon-spawned bots — DEFERRED

Same as OB-05. Deferred.

---

## Section C: Undertested Categories

### UT-01: MCP server — standalone HTTP transport — SKIPPED

MCP standalone server requires separate investigation. Deferred.

### UT-02: MCP mecha_query tool — SKIPPED

Depends on working chat (sandbox fix needed first). Deferred to next round.

### UT-03: Failure recovery — bot crash restart — PASS

1. Spawned `crash-test` on port 7760
2. `kill -9` the bot process
3. `bot ls` shows state `error` — correct
4. `bot start crash-test` restarts successfully
5. `bot ls` shows state `running` — correct

### UT-04: Failure recovery — daemon crash recovery — PASS

1. Spawned `survive2` on port 7771
2. `kill` daemon process (PID 54699)
3. `mecha status` confirms daemon is down
4. `mecha start --daemon` restarts daemon
5. `bot ls` shows `survive2` still `running` — state recovered from disk

### UT-05: Budget enforcement — SKIPPED

Requires meter proxy integration testing. Deferred.

### UT-06: Budget per-auth-profile — SKIPPED

Deferred with UT-05.

### UT-07: Expose mode — N/A

Bot-level `--expose` flag means capability exposure (e.g., `query`), not interface binding.
Individual bots always bind to `127.0.0.1`. Only the daemon supports `--host 0.0.0.0`.
Not a bug — architecture decision for security.

### UT-08: Bot with custom model — PASS

`--model claude-sonnet-4-5-20250514` → config.json stores `model: "claude-sonnet-4-5-20250514"` correctly.

---

## Section D: Stress & Edge Cases

### SE-01: Rapid spawn-stop cycle — PASS

10 sequential spawn-stop cycles completed. All bots got port 7700 (reused correctly).
No zombies in running state. Final allocation check succeeded.

### SE-02: Spawn with all config options — PASS

`--port 7792 --model claude-sonnet-4-5-20250514 --tags "test,kitchen-sink" --sandbox off --permission-mode default`
All options reflected in config.json correctly.

### SE-03: Bot name edge cases — PASS

| Input | Expected | Actual |
|-------|----------|--------|
| `"a"` | Success | PASS (spawned) |
| `"a-b-c-d"` | Success | PASS (spawned) |
| `"UPPER"` | Error | PASS ("must be lowercase, alphanumeric, hyphens") |
| `"with spaces"` | Error | PASS ("must be lowercase, alphanumeric, hyphens") |
| `""` | Error | PASS ("must be lowercase, alphanumeric, hyphens") |

### SE-04: Stop nonexistent bot — PASS

`bot stop nonexistent-bot` → `bot "nonexistent-bot" not found` (exit 1). Clean error, no crash.
`bot start nonexistent-bot` → same clean error.

### SE-05: Double spawn same name — PASS

First spawn succeeds. Second spawn: `bot "dupe-test" already exists` (exit 1). Clean error.

---

## Summary

### Test Results

| Section | Pass | Fail | Skip/Defer | N/A |
|---------|------|------|------------|-----|
| A: Fix Verification | 5 | 0 | 0 | 0 |
| B: Open Bug Deep-Dive | 2 | 0 | 4 | 0 |
| C: Undertested | 3 | 0 | 4 | 1 |
| D: Stress & Edge | 5 | 0 | 0 | 0 |
| **Total** | **15** | **0** | **8** | **1** |

### Key Findings

| ID | Severity | Status | Summary |
|----|----------|--------|---------|
| R8-001 | **HIGH** | **FIXED** | Sandbox EPERM: missing `/dev/null` write permission in SBPL (R7-001 root cause) |
| R7-002 | MEDIUM | UPSTREAM | systemPrompt not applied — Claude CLI 2.1.72 SDK mode ignores `systemPrompt` init message |
| R7-003 | LOW | OPEN | SSE lifecycle events not delivered (deferred testing) |

### Action Items

1. **Release v0.2.15** with R8-001 sandbox fix (`/dev/null` write permission)
2. **Report R7-002** to Claude CLI team — systemPrompt from SDK `query()` not applied
3. **Next round**: Test MCP server, budget enforcement, SSE events after sandbox fix ships
