# Round 6 Findings — v0.2.12

**Date**: 2026-03-11
**Tester**: Claude Code (automated)
**Version**: 0.2.12
**Machines**: local (joker-mbp), spark01 (Linux arm64), linode02 (Linux x64), mac-mini (macOS arm64)

## Goals

1. **Verify R5 fixes** — R5-001 (port collision), R5-002 (session path), R5-004 (sandbox claude binary), R5-005 (auth error message)
2. **Deeper integration tests** — end-to-end chat flows, cross-node bot communication, schedule execution, session persistence
3. **New areas** — ACL enforcement, plugin system, audit log, TOTP dashboard auth, bot environment isolation

---

## Results Summary

| # | Result | Notes |
|---|--------|-------|
| FV-01 | **FAIL** | R5-001 REGRESSION: `bot spawn` blocked by daemon holding cli.lock |
| FV-02 | **FAIL** | R5-004 INCOMPLETE: sandbox allows resolved claude path but posix_spawn uses symlink path |
| FV-03 | PASS | R5-002 session path fix works — `/tmp` sessions correctly found via `/private/tmp` |
| FV-04 | SKIP | R5-005: Cannot test — claude CLI uses OAuth, ignores invalid ANTHROPIC_API_KEY |
| DI-01 | PASS | End-to-end chat + session persistence across restart |
| DI-02 | **FAIL** | Cross-node query returns 403 — ACL engine ignores wildcard `*` rules |
| DI-03 | PASS | ACL enforcement — explicit source→target rules work correctly |
| DI-04 | PASS | Schedule execution + history |
| DI-05 | PASS | Audit log recording |
| DI-06 | **BLOCKED** | Plugin add/rm blocked by R6-001 (cli.lock held by daemon) |
| DI-07 | PASS* | Bot env isolation — LLM refuses to leak API keys; no OS-level sandbox enforced (sandboxMode not set) |
| DI-08 | PASS | Dashboard TOTP auth + bot management via API |
| DI-09 | PASS* | Force stop/restart work; non-force stop fails when Content-Type:application/json sent with no body (R6-005) |
| DI-10 | **FAIL** | Custom system prompt not applied — config.json stores it but runtime never passes it to SDK query() |

---

## New Findings

### R6-001: cli.lock REGRESSION — Daemon blocks all mutating CLI commands

**Severity**: Critical
**Component**: `packages/cli/src/program.ts`
**Reproducer**:
```bash
# With daemon running:
mecha bot spawn testbot --workspace /tmp    # → "Another mecha CLI is already running (pid XXXXX)"
mecha plugin add test --type stdio --command echo  # → same error
mecha acl grant bot1 query bot2             # → same error
```

**Root cause**: `MUTATING_COMMANDS` array in program.ts includes commands like `"bot spawn"`, `"plugin add"`, `"acl grant"`. These all try to acquire `cli.lock`, but the daemon holds it permanently via `mecha start`. Any CLI command in the list is blocked.

**Impact**: All mutating CLI commands fail while daemon is running. Workaround: use daemon HTTP API directly with TOTP session cookie.

**Fix**: Remove `"bot spawn"` and other daemon-proxied commands from `MUTATING_COMMANDS`. When daemon is running, these commands are proxied to the daemon API which has its own per-bot mutex (`withBotLock`). The CLI doesn't need `cli.lock` for daemon-proxied operations.

---

### R6-002: ACL engine ignores wildcard `*` rules

**Severity**: High
**Component**: `packages/core/src/acl/engine.ts`
**Reproducer**:
```bash
mecha acl grant '*' query mybot    # Rule saved
# Any bot trying to query mybot → 403 "Access denied"
```

**Root cause**: `findRule()` at line ~58 uses exact string match:
```typescript
data.rules.find((r) => r.source === source && r.target === target)
```
A rule with `source: "*"` only matches when the requesting bot's name is literally `"*"`. No glob/wildcard matching exists.

**Fix**: Add wildcard matching in `findRule()`:
```typescript
data.rules.find((r) =>
  (r.source === source || r.source === "*") &&
  (r.target === target || r.target === "*")
)
```

---

### R6-003: Sandbox `dedup()` resolves symlinks, losing Seatbelt-required paths

**Severity**: High (macOS only)
**Component**: `packages/sandbox/src/profile.ts:18-21`
**Reproducer**: Bot spawned on macOS where `claude` is a symlink:
```
~/.local/bin/claude → ~/.local/share/claude/versions/2.1.72/claude
```
Sandbox profile's `dedup()` calls `realpathSync()` and converts to target path. But macOS Seatbelt (`sandbox-exec`) uses `(allow process-exec (literal "..."))` which checks the **spawn path**, not the resolved target. The bot is allowed to execute the target but `posix_spawn` uses the symlink path → EPERM.

**Fix**: Include both the original path AND the resolved path in `allowedProcesses`:
```typescript
function dedup(paths: string[]): string[] {
  const resolved = new Set<string>();
  const result: string[] = [];
  for (const p of paths) {
    const r = realpathSyncSafe(p);
    if (!resolved.has(r)) {
      resolved.add(r);
      result.push(r);
    }
    // Also keep original if different (symlinks needed by Seatbelt)
    if (r !== p && !resolved.has(p)) {
      result.push(p);
    }
  }
  return result;
}
```

---

### R6-004: Custom systemPrompt not applied to SDK query

**Severity**: High
**Component**: `packages/runtime/src/sdk-chat.ts`, `packages/runtime/src/server.ts`
**Reproducer**:
```bash
# Spawn bot with system prompt via API:
curl -X POST http://localhost:7660/bots -d '{
  "name":"pirate", "workspace":"/tmp",
  "systemPrompt":"You are a pirate. Always respond in pirate speak."
}'
# Chat with bot:
curl -X POST http://localhost:7702/api/chat -d '{"message":"Hello"}'
# → Normal response, not pirate speak
```

**Root cause**: `server.ts:57-60` builds `chatOpts` with only `workspacePath` and `settingSources`. The bot's `config.json` has `systemPrompt` stored correctly, but `sdkChat()` never reads it. The SDK's `query()` function accepts `systemPrompt` in its options (confirmed in SDK types at line 1126 of `sdk.d.ts`), but it's never passed.

The `buildClaudeArgs()` function in `packages/agent/src/build-claude-args.ts` correctly converts `systemPrompt` to `--system-prompt` CLI arg, but this function is unused in the SDK query path.

**Fix**:
1. Add `systemPrompt` and `appendSystemPrompt` to `SdkChatOpts`
2. In `createServer()`, read the bot config and pass the prompt fields to `chatOpts`
3. In `sdkChat()`, pass `systemPrompt` to the SDK's `query()` options:
```typescript
for await (const event of query({
  prompt: message,
  options: {
    cwd: opts.workspacePath,
    systemPrompt: opts.systemPrompt,  // ← ADD THIS
    // ...
  },
}))
```

---

### R6-005: POST endpoints return 500 when Content-Type:application/json set with empty body

**Severity**: Medium
**Component**: Fastify body parsing (affects all POST routes)
**Reproducer**:
```bash
curl -X POST http://localhost:7660/bots/pirate/stop -H 'Content-Type: application/json'
# → 500 Internal Server Error

curl -X POST http://localhost:7660/bots/pirate/stop -H 'Content-Type: application/json' -d '{}'
# → 200 OK
```

**Root cause**: Fastify's JSON body parser rejects empty body when `Content-Type: application/json` is declared. The error propagates as an unhandled Fastify parse error before the route handler runs. The `request.body ?? {}` defensive guard never executes.

**Fix**: Either:
1. Configure Fastify with `{ bodyLimit: 0 }` and handle empty bodies, or
2. Add a preHandler hook that sets `request.body = {}` when body is missing for POST routes that accept optional bodies

---

## Passed Tests Detail

### DI-01: End-to-end chat + session persistence
- Sent message to tmpbot, received response with sessionId
- Restarted daemon, sent resume message with same sessionId
- Bot correctly resumed session context

### DI-03: ACL enforcement
- Granted `tmpbot → noauth (query)` via `mecha acl grant`
- tmpbot → noauth query: **200 OK** (response received)
- pirate → noauth query: **403** "Access denied: pirate cannot query noauth"
- Explicit ACL rules enforced correctly; only wildcard `*` rules fail (R6-002)

### DI-04: Schedule execution + history
- Added cron schedule to bot, verified it executed at scheduled time
- Schedule history endpoint returned execution records with status/duration

### DI-05: Audit log recording
- Verified `events.jsonl` records bot lifecycle events (spawn, stop, restart)
- Entries include timestamp, event type, bot name, actor

### DI-07: Bot environment isolation
- Pirate bot asked to read tmpbot's config.json → "I don't have permission"
- **Note**: This is LLM-level refusal, not OS sandbox enforcement. `sandboxMode` not set on test bots.
- API key leak test: bot correctly refused to reveal ANTHROPIC_API_KEY value
- **Caveat**: Without `sandboxMode: "require"`, isolation depends on Claude Code's permission system, not process-level sandboxing

### DI-08: Dashboard TOTP auth
- `POST /auth/login` with valid TOTP code → `{"ok":true}` + session cookie
- `POST /auth/login` with invalid code → `{"error":"Invalid TOTP code"}`
- Authenticated `GET /bots` → returns bot list (4 bots)
- `GET /auth/status` → `{"methods":{"totp":true}}`
- Unauthenticated `GET /bots` → `{"error":"Unauthorized"}`

### DI-09: Concurrent bot operations
- Force stop pirate while tmpbot chatting → `{"ok":true}`, tmpbot chat unaffected
- Force restart → `{"ok":true}`, bot comes back on same port
- Non-force stop with `{}` body → works correctly (checks busy state)
- Non-force stop with no body + Content-Type:application/json → 500 (R6-005)

---

## Summary of Findings by Severity

| # | Severity | Title | Status |
|---|----------|-------|--------|
| R6-001 | Critical | cli.lock blocks all mutating CLI commands while daemon runs | NEW |
| R6-002 | High | ACL engine ignores wildcard `*` rules | NEW |
| R6-003 | High | Sandbox dedup() loses symlink paths needed by Seatbelt | NEW |
| R6-004 | High | Custom systemPrompt not passed to SDK query() | NEW |
| R6-005 | Medium | POST endpoints 500 on empty JSON body | NEW |

## Carryover from R5 (Unresolved)

| # | Original | Status |
|---|----------|--------|
| FV-01 | R5-001 | REGRESSION — original port collision fix caused cli.lock contention |
| FV-02 | R5-004 | INCOMPLETE — symlink path not in sandbox allowlist |
