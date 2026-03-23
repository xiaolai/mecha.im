# Finding 001: /api/chat endpoint hangs indefinitely

**Date**: 2026-03-10
**Severity**: CRITICAL (P0 blocker)
**Version**: v0.2.7
**Affected**: All platforms (Linux x64, Linux arm64, macOS arm64)
**Category**: 02-chat-query (tests 2.1, 2.5)

## Symptom

`POST /api/chat` accepts the request, validates auth, but never responds. Curl times out after 120s with 0 bytes received.

Both CLI chat (`mecha bot chat`) and HTTP API hang.

## Root Cause

The Agent SDK's `query()` function tries to spawn the `claude` CLI binary as a subprocess. In compiled Bun binaries, the SDK's built-in `claude` executable lives inside `$bunfs` (Bun's virtual filesystem) and **cannot be spawned as a child process**.

`query()` silently fails to spawn — no child process appears, no error is thrown. The async iterator hangs forever.

Evidence:
- `pstree` shows no `claude` child process under the bot during a chat request
- The bot's stderr.log has no SDK errors
- `claude -p "test"` works perfectly when invoked directly on the command line

## Fix

Added `pathToClaudeCodeExecutable` option to `query()` call in `packages/runtime/src/sdk-chat.ts`:

1. At module load, resolve `claude` binary via `which claude`
2. Pass the resolved path as `pathToClaudeCodeExecutable` to `query()`
3. If `claude` is not found in PATH, log a warning and let SDK try built-in (may still fail in compiled binary)

## Prerequisite

**`claude` CLI must be installed separately** on every machine running mecha:

```bash
# npm
npm install -g @anthropic-ai/claude-code

# Or on macOS
brew install claude
```

This is a new runtime dependency introduced in v0.2.7 (previously chat was a 501 stub).

## Actual Fix (v2)

The initial fix (resolving `which claude` inside the bot process) didn't work because the bot runs inside a bwrap sandbox where `/usr/local/bin/claude` is a symlink to `../lib/node_modules/...` which isn't mounted.

**Two-part fix:**
1. `packages/process/src/build-bot-env.ts` — Resolve `claude` path in the **parent** process (agent server, outside sandbox) and pass it as `MECHA_CLAUDE_PATH` env var
2. `packages/runtime/src/sdk-chat.ts` — Read `MECHA_CLAUDE_PATH` env first, fallback to `which claude`, pass to SDK's `pathToClaudeCodeExecutable` option

## Actual Fix (v3) — macOS PATH

Fix v2 worked on Linux but failed on macOS:
- **With sandbox**: `EPERM: posix_spawn '/opt/homebrew/bin/claude'` — Seatbelt blocks execution
- **Without sandbox**: `exit code 127` — `claude` shebang is `#!/usr/bin/env node` but bot PATH doesn't include `/opt/homebrew/bin` where `node` lives

**Fix:** Added `/opt/homebrew/bin` to bot PATH on macOS (darwin) in `build-bot-env.ts`. This ensures `node` is available when the OS resolves the `claude` shebang.

## Verified

All three platforms:

```
# spark01 (Linux arm64)
{"response":"4","sessionId":"8d69bf39-...","durationMs":3156,"costUsd":0.011923}

# linode02 (Linux x64)
{"response":"4","sessionId":"949382c6-...","durationMs":1851,"costUsd":0.004014}

# mac-mini-home (macOS arm64)
{"response":"4","sessionId":"97087a4e-...","durationMs":1975,"costUsd":0.004248}
```

## Status

- [x] Root cause identified
- [x] Fix v1: resolve in bot process — FAILED (sandbox blocks)
- [x] Fix v2: resolve in parent, pass via env — WORKS (Linux only)
- [x] Fix v3: add /opt/homebrew/bin to macOS PATH — WORKS (all platforms)
- [x] Verified on spark01 (Linux arm64)
- [x] Verified on linode02 (Linux x64)
- [x] Verified on mac-mini-home (macOS arm64)
- [ ] Needs release (v0.2.8)
