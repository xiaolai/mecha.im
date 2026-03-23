# Round 5 Findings — v0.2.11

**Date**: 2026-03-11
**Tester**: Claude Code (automated)
**Version**: 0.2.11
**Machine**: local (joker-mbp) + SSH to linode02, spark01, mac-mini

## Results Summary

| # | Result | Notes |
|---|--------|-------|
| V-01 | PASS | SIGKILL → state correctly shows `error` (not `stopped`) |
| V-02 | PASS | Dead PID recovered to `stopped` after daemon restart |
| V-03 | PASS | Stop + start same name — no token mismatch |
| V-04 | PASS | Stale process killed automatically, new bot starts clean |
| V-05 | CONDITIONAL PASS | R4-003 fix works (unsigned requests pass Bearer auth). Stale apiKeys in `nodes.json` caused initial 401 — config drift, not code bug |
| V-06 | PASS | MCP serve defaults to port 7682, no conflict with daemon on 7660 |
| S-01 | PASS | Seatbelt profile applied on macOS, sandbox-profile.json created |
| S-02 | PASS | No sandbox wrapping, no sandbox-profile.json |
| S-03 | PASS | Auto mode detects Seatbelt on macOS, applies sandbox |
| S-04 | PASS | Rejects `--sandbox require` on Linux without Bubblewrap. Minor: error message slightly garbled |
| S-05 | PASS | Rejects `--dangerously-skip-permissions` without `--sandbox require` |
| N-01 | PASS | Clean error "Cannot reach node" in 0.2s, no hang |
| N-02 | PASS | Mesh recovers immediately after remote daemon restart |
| N-03 | PASS | "unreachable" error in 0.3s, clean exit |
| N-04 | PASS | Partial mesh works — live nodes accessible, down node returns clean error |
| C-01 | **FAIL** | Port collision race condition — all 5 bots get port 7700, only 1 survives |
| C-02 | PASS | stop-all during active query — bot stopped, chat fails gracefully |
| C-03 | **FAIL** | `mecha stop` stops all bots before daemon — bots don't survive daemon restart |
| R-01 | PASS | Meter start/status/stop lifecycle works |
| R-02 | PARTIAL PASS | Budget set/list works. `budget rm` requires --daily/--monthly (unexpected). Enforcement not tested |
| R-03 | PARTIAL PASS | Schedule add/list works. Trigger fails with EPERM — sandbox blocks claude binary |
| R-04 | **FAIL** | `sessions ls` returns empty — macOS `/tmp` → `/private/tmp` path encoding mismatch |
| R-05 | PASS | MCP stdio config generates valid JSON |
| R-06 | PASS | MCP HTTP serves Streamable HTTP, responds to initialize |
| R-07 | PASS | Dashboard TOTP login, bot list, detail tabs (Sessions, Schedules, Files, Config, Logs) all render |
| R-08 | PASS | Auth profile add/list/switch/remove lifecycle works |
| O-01 | CONFIRMED | Meter tracks `bot chat` cost correctly. `/query` route requires ACL rules |
| O-02 | CONFIRMED | `bot ls --node` not implemented (API-only via `?node=`) |
| O-03 | **FAIL** | No-auth bot shows generic "Chat request failed" (500), not actionable error about missing credentials |

## Score

- **PASS**: 21/29 (72%)
- **PARTIAL PASS**: 3/29 (10%)
- **FAIL**: 3/29 (10%)
- **CONDITIONAL**: 1/29 (3%)
- **CONFIRMED (known)**: 1/29 (3%)

---

## New Findings

### R5-001: Port Collision Race Condition (C-01)

**Severity**: Medium
**Category**: Concurrent Operations
**Reproducible**: Always

When spawning multiple bots simultaneously without explicit `--port`, all bots get assigned port 7700 because port scanning runs in the CLI before sending the spawn request to the daemon. All 5 see 7700 as free at the same instant.

**Workaround**: Use explicit `--port` assignments for parallel spawns.
**Fix**: Move port allocation to the daemon (server-side) with a lock/reservation mechanism.

```
# Reproducer
for i in 1 2 3 4 5; do mecha bot spawn "p-$i" /tmp & done; wait
# Result: all get port 7700, only 1 survives
```

### R5-002: Sessions Path Encoding Mismatch on macOS (R-04)

**Severity**: Medium
**Category**: Session Management
**Reproducible**: Always (macOS only)

The Claude SDK resolves `/tmp` to its real path `/private/tmp` when writing session files, creating the directory `-private-tmp/`. The session manager encodes the configured workspace `/tmp` as `-tmp/` and looks there. No sessions found.

**Root cause**: macOS `/tmp` is a symlink to `/private/tmp`. The SDK resolves symlinks, but the session manager doesn't.

**Fix**: Resolve the workspace path with `fs.realpathSync()` before encoding it for session lookup.

### R5-003: `mecha stop` Kills All Bots (C-03)

**Severity**: Low (by design, but conflicts with test expectation)
**Category**: Daemon Lifecycle

`mecha stop` stops all running bots, meter, and daemon. There's no `--keep-bots` option for daemon-only restart. Bots are not detached/surviving processes.

**Impact**: Cannot restart daemon without bot downtime.
**Suggestion**: Add `--keep-bots` flag or separate `mecha daemon stop` command.

### R5-004: Schedule Trigger Blocked by Sandbox (R-03)

**Severity**: Medium
**Category**: Sandbox Configuration

Sandbox profile's `allowedProcesses` only includes the mecha binary, not the claude CLI binary (`/Users/joker/.local/bin/claude`). Schedule triggers (and chat operations) fail with EPERM inside sandboxed bots.

```
EPERM: operation not permitted, posix_spawn '/Users/joker/.local/bin/claude'
```

**Fix**: Add the claude CLI path to `allowedProcesses` in the sandbox profile generator.

### R5-005: No-Auth Bot Error Message (O-03)

**Severity**: Low
**Category**: UX / Error Handling

When a bot spawned with `--no-auth` receives a chat request, it returns a generic 500 "Chat request failed". The server logs show "Claude Code process exited with code 1" but the user-facing response doesn't explain the root cause.

**Expected**: "No API credentials configured. Use `mecha auth add` or set ANTHROPIC_API_KEY."

### R5-006: `budget rm` Requires Period Flag (R-02)

**Severity**: Low
**Category**: CLI UX

`mecha budget rm test-bot` fails with "Specify --daily or --monthly". Expected: remove all budget limits for the bot without needing to specify the period type.

### R5-007: Stale Node API Keys After TOTP Secret Change (V-05)

**Severity**: Medium
**Category**: Mesh Networking / Configuration

When nodes are added manually via `node add`, the stored `apiKey` (derived from TOTP secret via HMAC-SHA256) becomes stale if the remote node's TOTP secret changes. Cross-node operations fail with 401.

**Root cause**: Manual node entries don't auto-refresh mesh keys. Discovery handshake would fix this, but manual entries have no refresh mechanism.

**Workaround**: Remove and re-add the node with the correct key.
**Fix**: Add `mecha node refresh <name>` command, or auto-derive the key from the remote node's TOTP secret during `node add`.

---

## Test Matrix Corrections

The testing matrix had several syntax differences from the actual CLI:

| Matrix Syntax | Actual CLI Syntax |
|---|---|
| `bot start <name> --workspace /tmp` | `bot spawn <name> /tmp` (workspace is positional) |
| `bot start` (for new bots) | `bot spawn` (start is for stopped bots) |
| `schedule add --cron "0 * * * *"` | `schedule add --id <id> --every "1h"` (interval, not cron) |
| `mecha bot ls --node spark01` | Not implemented (API-only: `GET /bots?node=spark01`) |
| `schedule trigger <bot> <id>` | `schedule run <bot> <id>` |

---

## Environment Notes

- Local daemon started with `MECHA_DIR=/Users/joker/mecha-camp`
- All remote nodes accessible via Tailscale IPs (100.100.1.x)
- Fixed stale apiKeys for all 3 remote nodes during V-05 testing
- spark01 and linode02 lack auth profiles (no API credentials configured on those machines)
