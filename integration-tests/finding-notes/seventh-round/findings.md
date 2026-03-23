# Round 7 Findings — v0.2.13

**Date**: 2026-03-11
**Tester**: Claude Code (automated)
**Version**: 0.2.13
**Machines**: local (joker-mbp), spark01 (Linux arm64), linode02 (Linux x64), mac-mini (macOS arm64)

## Goals

1. **Verify R6 fixes** — R6-001 (cli.lock deadlock), R6-002 (ACL wildcard), R6-003 (symlink dedup), R6-004 (systemPrompt), R6-005 (empty JSON body)
2. **Deeper integration tests** — areas not yet tested:
   - Mesh networking: cross-node routing with signature verification
   - Budget enforcement: meter proxy + budget limits
   - Plugin system: add/rm/ls (now unblocked by R6-001 fix)
   - Sandbox enforcement: sandboxMode=require with real Seatbelt
   - Bot configure: runtime config changes (model, tags, expose)
   - Session listing/management across restarts
   - Event SSE stream: real-time event delivery
   - Auth profiles: multi-credential management
   - Concurrent spawn race: parallel bot spawns on same port range

## Test Plan

| # | Category | Test | Target Machine |
|---|----------|------|----------------|
| FV-01 | R6-001 verify | `bot spawn` works while daemon running | local |
| FV-02 | R6-001 verify | `plugin add/rm` works while daemon running | local |
| FV-03 | R6-002 verify | ACL wildcard `*` grants cross-bot query | local |
| FV-04 | R6-004 verify | systemPrompt applied to bot chat | local |
| FV-05 | R6-005 verify | POST with empty body returns 200 | local |
| DI-01 | Mesh | Cross-node query with mesh routing | linode02 → spark01 |
| DI-02 | Budget | Meter proxy intercepts API calls, budget limit enforced | local |
| DI-03 | Plugin | Plugin add/rm/ls lifecycle | local |
| DI-04 | Sandbox | sandboxMode=require bot spawn + path enforcement | local (macOS) |
| DI-05 | Configure | Bot configure changes model/tags at runtime | local |
| DI-06 | Sessions | Session list/resume across daemon restart | local |
| DI-07 | Events SSE | Real-time event stream during bot lifecycle | local |
| DI-08 | Auth profiles | Add/switch/rm auth profiles | local |
| DI-09 | Concurrent | Parallel bot spawns — no port collision | local |
| DI-10 | Node mgmt | Node add/rm/ls + key generation | local |

---

## Results

### FV-01: `bot spawn` works while daemon running — PASS
Bot spawn succeeded while daemon was active. R6-001 cli.lock deadlock fix confirmed working.

### FV-02: `plugin add/rm` works while daemon running — PASS
Plugin add/rm/ls commands work while daemon is running. R6-001 fix confirmed.

### FV-05: POST with empty body returns 200 — PASS
`curl -X POST /healthz -H 'Content-Type: application/json' -d ''` returns 200. R6-005 custom JSON parser fix confirmed.

### FV-03: ACL wildcard `*` grants cross-bot query — PARTIAL PASS
ACL check itself PASSES: wildcard grant `* → tmpbot [query]` allows `r7test` to query. Got "upstream bot unavailable" (not 403 "access denied"), confirming ACL permits the request. However, the upstream bot (tmpbot) failed to process the chat — see R7-001.

### DI-04: Sandbox — sandboxMode=auto blocks SDK chat — **FINDING R7-001**

**Severity**: HIGH
**Category**: Sandbox / SDK integration

**Symptom**: `POST /api/chat` returns 500 with `"EPERM: operation not permitted, posix_spawn '/Users/joker/.local/bin/claude'"` when bot is spawned with `--sandbox auto` on macOS.

**Root cause**: macOS Seatbelt sandbox profile restricts `process-exec` to an explicit allowlist. The sandbox profile correctly includes the claude CLI binary (both symlink `/Users/joker/.local/bin/claude` and resolved `/Users/joker/.local/share/claude/versions/2.1.72`). However, when the sandboxed mecha runtime calls `query()` from the Claude Agent SDK, the SDK's internal spawn mechanism fails.

**Investigation details**:
- `--sandbox off` → chat works immediately (4.6s round-trip)
- `--sandbox auto` → EPERM on posix_spawn within 3ms
- Manually running `sandbox-exec -f sandbox.sbpl /Users/joker/.local/bin/claude --version` works
- Manually running `sandbox-exec -f sandbox.sbpl node -e "spawn(claude)"` works (with node in allowedProcesses)
- Even with `(allow process-exec*)` (allow ALL process execution), the SDK spawn fails with exit code 1 (different error: "Claude Code process exited with code 1")
- The Bun-compiled mecha binary spawns claude via the SDK's `query()` → `child_process.spawn()` → `posix_spawn`
- Hypothesis: either the Bun runtime's compiled spawn implementation differs from stock Node, or the SDK has an internal dependency that requires file-write access to paths not in the write allowlist (e.g. `/tmp` outside botDir/tmp)

**Workaround**: Use `--sandbox off` for now. Hook-based sandbox (`.claude/hooks/sandbox-guard.sh` + `bash-guard.sh`) still provides path-level file access control.

**Fix needed**:
1. Add `/tmp` (or `TMPDIR`) to sandbox write paths — the SDK/claude may need global temp access
2. Audit what the claude CLI process writes on startup to determine required write paths
3. Consider adding `(allow process-exec (subpath "/usr/bin"))` and `(allow process-exec (subpath "/bin"))` for system utilities

---

### FV-04: systemPrompt applied to bot chat — **FINDING R7-002**

**Severity**: MEDIUM
**Category**: SDK integration / systemPrompt

**Symptom**: Bot spawned with `--system-prompt "You are a pirate..."` does not use the custom system prompt. Chat responses use the default Claude Code system prompt.

**Evidence**:
- `config.json` correctly stores `"systemPrompt": "You are a pirate. Always respond as a pirate would, using pirate language."`
- `readBotConfig()` reads the field correctly
- `sdk-chat.ts` constructs the `sysPrompt` and spreads it into `query()` options
- Session transcript shows `cache_read_input_tokens: 17689` (standard Claude Code prompt) with `input_tokens: 3` (just user message)
- Response: standard Claude identity, no pirate persona
- Direct SDK test (`npx tsx` with `CLAUDECODE=` unset) confirms SDK DOES honor systemPrompt (returns pirate-talk)

**Root cause hypothesis**: The Bun-compiled mecha binary bundles the SDK. Either:
1. The bundled SDK version doesn't propagate `systemPrompt` to the CLI spawn args
2. The Bun runtime's `child_process.spawn` doesn't forward the JSON init message correctly
3. The compiled binary has a stale SDK version that pre-dates systemPrompt support

**Workaround**: None currently. Custom system prompts via `--system-prompt` or `--append-system-prompt` are not applied.

**Fix needed**: Verify the SDK version bundled in the mecha binary matches the workspace dependency. Rebuild with current SDK that passes systemPrompt correctly.

---

### DI-02: Budget enforcement — PARTIAL PASS

Meter proxy is running and intercepts API calls. Budget set/ls/rm commands work. Setting a $0.001 daily budget on tmpbot caused subsequent chat requests to hang (HTTP 000 / timeout). The meter proxy likely rejected the API call but the SDK didn't surface a clean error — instead the request hung until timeout.

**Finding**: Budget enforcement blocks API calls but doesn't produce a user-friendly error. The bot's `/api/chat` response should return a clear 429 or 402 with a budget-exceeded message instead of hanging.

### DI-03: Plugin lifecycle — PASS

All operations work correctly:
- `plugin add test-plugin --type stdio --command echo` → registered
- `plugin ls` → shows plugin with correct type/command
- Duplicate add without `--force` → rejected
- Duplicate add with `--force` → overwrites
- `plugin add web-api --type http --url http://...` → registered
- `plugin rm test-plugin` → removed
- `plugin rm web-api` → removed
- Final `plugin ls` → empty

### DI-05: Bot configure — PARTIAL PASS

Tags and expose can be configured at runtime:
- `bot configure tmpbot --tags "ai,test,r7"` → updated, visible in `bot ls`
- `bot configure tmpbot --expose "query,read_workspace"` → updated in config.json

**Limitation**: No `--model` option in `bot configure`. Model can only be set at spawn time. If users want to change model, they must stop/remove/re-spawn the bot.

### DI-06: Session list/resume — PASS

- `GET /api/sessions` returns empty array initially
- After chat, session appears with id, title, timestamps
- Resume with `sessionId` in request body correctly restores context ("What was my first message?" → "Say hello")
- Session is persisted as `.jsonl` in `<botDir>/.claude/projects/<encoded-path>/`

### DI-07: Events SSE — **FINDING R7-003**

**Severity**: LOW
**Category**: SSE events

SSE endpoint at `GET /events` (on agent server port 7660) connects successfully and sends heartbeats. However, bot lifecycle events (stop/spawn) are NOT delivered to connected SSE clients. Only `: heartbeat` comments are received.

The process manager emits events internally but they don't reach SSE subscribers. Possible cause: the events are emitted by the CLI's process manager, not the daemon's — the daemon receives HTTP API calls and handles them, but the process manager instance that the SSE handler subscribes to may not be the same one emitting the events.

### DI-08: Auth profiles — PASS

- `auth add test-profile --api-key --token sk-ant-test123` → created, auto-set as default
- `auth ls` → shows profile with correct type and default marker
- `auth default test-profile` → sets default
- `auth rm test-profile` → removed
- `auth ls` → falls back to `$env:api-key`

### DI-09: Concurrent spawn — **FINDING R7-004**

**Severity**: MEDIUM
**Category**: Port assignment race condition

Three concurrent bot spawns (conc-a, conc-b, conc-c) without explicit ports ALL assigned port 7701. Only one (conc-b) succeeded; the other two entered `error` state because the port was already bound.

**Root cause**: Port scanner scans the 7700-7799 range for available ports but doesn't use locking. When multiple spawns run concurrently, they all see the same port as available before any of them bind it.

**Fix needed**: Use an atomic port reservation mechanism (e.g., file-based lock, or try-bind with retry on EADDRINUSE).

**Status**: FIXED — `allocatePort()` now uses `claimPort()` which atomically binds a TCP server via `net.createServer().listen()`. The port is held until release, preventing concurrent spawns from claiming the same port. Removed the in-process-only `reservedPorts` set and `portAllocationLock` mutex.

### DI-10: Node management — PASS

- `node add test-node 192.168.1.100 --api-key test-key-123` → added
- `node ls` → shows all nodes including new one with correct host/port
- `node rm test-node` → removed
- `node ls` → node gone, existing nodes unaffected

### DI-01: Mesh networking — SKIPPED

Cross-node query test (linode02 → spark01) skipped due to R7-001 (sandbox blocks SDK chat) and R7-002 (systemPrompt not applied). These need to be fixed before mesh routing can be meaningfully tested, since mesh queries go through the bot's `/api/chat` endpoint.

---

## Summary

| # | Test | Result |
|---|------|--------|
| FV-01 | bot spawn works while daemon running | PASS |
| FV-02 | plugin add/rm works while daemon running | PASS |
| FV-03 | ACL wildcard grants cross-bot query | PARTIAL (ACL works, upstream chat fails) |
| FV-04 | systemPrompt applied to bot chat | **FAIL — R7-002** |
| FV-05 | POST with empty body returns 200 | PASS |
| DI-01 | Cross-node mesh query | SKIPPED |
| DI-02 | Budget enforcement | PARTIAL (blocks but hangs, no clear error) |
| DI-03 | Plugin lifecycle | PASS |
| DI-04 | Sandbox enforcement | **FAIL — R7-001** |
| DI-05 | Bot configure | PARTIAL (no --model) |
| DI-06 | Session list/resume | PASS |
| DI-07 | Events SSE | **FAIL — R7-003** |
| DI-08 | Auth profiles | PASS |
| DI-09 | Concurrent spawn | **FAIL — R7-004** |
| DI-10 | Node management | PASS |

## Findings

| ID | Severity | Title |
|----|----------|-------|
| R7-001 | HIGH | macOS Seatbelt sandbox blocks SDK chat (posix_spawn EPERM) |
| R7-002 | MEDIUM | systemPrompt not applied to bot chat via SDK |
| R7-003 | LOW | SSE events not delivered for bot lifecycle |
| R7-004 | MEDIUM | Concurrent spawns race on port assignment |
