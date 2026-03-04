# Documentation Audit Report

**Project**: mecha.im
**Date**: 2026-03-04
**Language**: TypeScript
**Framework**: VitePress

## Executive Summary

| Dimension | Score | Status |
|-----------|-------|--------|
| Freshness | 100/100 | :green_circle: |
| Accuracy  | 0/100 | :red_circle: |
| Coverage  | 89%    | :yellow_circle: |
| Quality   | 91/100 | :green_circle: |

**Overall health**: 70/100

The documentation is structurally excellent and remarkably fresh (all docs updated within 4 days of code changes). However, **3 critical accuracy issues** make documented workflows completely broken for users — wrong command names, wrong default ports, and a non-functional CLI option. These must be fixed immediately.

## Critical Findings (fix immediately)

### [CRITICAL] `sessions.md` uses non-existent command names
- **Source**: `packages/cli/src/commands/bot-chat.ts:9`, `bot-sessions.ts:16,44`
- **Doc**: `website/docs/features/sessions.md:8-21`
- **Code says**: Commands are `mecha bot chat`, `mecha bot sessions list`, `mecha bot sessions show`
- **Doc says**: `mecha chat`, `mecha sessions list`, `mecha sessions show` — none of these exist
- **Fix**: Prefix all three with `bot`

### [CRITICAL] `dashboard.md` default port is `3457` — code uses `7660`
- **Source**: `packages/cli/src/commands/dashboard-serve.ts:107`
- **Doc**: `website/docs/features/dashboard.md:11,22-23`
- **Code says**: `DEFAULTS.AGENT_PORT = 7660`
- **Doc says**: "Opens the dashboard at http://localhost:3457"
- **Fix**: Replace all `3457` references with `7660` in dashboard.md

### [CRITICAL] `mecha auth-config --no-totp` always throws — documented as functional
- **Source**: `packages/core/src/auth-config.ts:55-62`
- **Doc**: `website/docs/reference/cli.md:1033-1044`
- **Code says**: `validateAuthConfig()` unconditionally throws when `config.totp` is `false`
- **Doc says**: `--no-totp` is a valid option with a working example
- **Fix**: Either remove `--no-totp` from docs or fix the validator

## High Findings (fix soon)

### [HIGH] `mecha node add` example omits required `--api-key`
- **Source**: `packages/cli/src/commands/node-add.ts:13` — `.requiredOption("--api-key <key>")`
- **Doc**: `website/docs/features/mesh-networking.md:118`
- **Doc says**: `mecha node add bob 192.168.1.50 --port 7660` (no api-key — would fail)
- **Fix**: Add `--api-key <key>` to the example

### [HIGH] `dashboard.md` uses `/api/` prefixed URLs — actual routes have no prefix
- **Source**: `packages/agent/src/routes/events.ts`, `bots.ts`, `audit.ts`, `meter.ts`, `mesh.ts`
- **Doc**: `website/docs/features/dashboard.md:152,232-238`
- **Doc says**: `/api/events`, `/api/bots`, `/api/audit`, `/api/meter/cost`, `/api/mesh/nodes`
- **Code says**: `/events`, `/bots`, `/audit`, `/meter/cost`, `/mesh/nodes`
- **Fix**: Remove `/api/` prefix from all route references in dashboard.md

### [HIGH] SSE heartbeat interval: doc says 15s, code says 10s
- **Source**: `packages/agent/src/routes/events.ts:9` — `HEARTBEAT_INTERVAL_MS = 10_000`
- **Doc**: `website/docs/features/dashboard.md:157`
- **Fix**: Change "Every 15 seconds" to "Every 10 seconds"

### [HIGH] PTY resize claims clamping that doesn't exist in code
- **Source**: `packages/agent/src/pty-manager.ts:197-201` — no bounds checking
- **Doc**: `website/docs/reference/architecture.md:320` — "clamped: cols 1-500, rows 1-200"
- **Fix**: Either add clamping to code or remove the claim from docs

### [HIGH] Undocumented env var: `MECHA_LOG_LEVEL`
- **Source**: `packages/core/src/logger.ts:16`
- **Expected doc**: `website/docs/reference/environment.md`
- **Impact**: Users cannot discover how to enable debug logging

### [HIGH] Undocumented env var: `MECHA_OTP`
- **Source**: `packages/core/src/totp-storage.ts:18`
- **Expected doc**: `website/docs/reference/environment.md`
- **Impact**: Required for CI/container deployments; CLI hints at it but docs don't explain it

## Medium Findings (fix soon)

### [MEDIUM] `configuration.md` uses non-existent `mecha configure` and `mecha spawn`
- **Source**: `packages/cli/src/commands/bot-configure.ts`, `bot-spawn.ts`
- **Doc**: `website/docs/guide/configuration.md:93-95,102-104`
- **Fix**: Change to `mecha bot configure` and `mecha bot spawn`

### [MEDIUM] `PermissionMode` values undocumented
- **Source**: `packages/core/src/schemas.ts:12` — `"default" | "plan" | "full-auto"`
- **Doc**: `website/docs/guide/configuration.md` mentions `permissionMode` but never explains values
- **Fix**: Add table explaining each mode and security implications

### [MEDIUM] `architecture.md` `GET /auth/profiles` placed under Auth Routes — actually registered in `bots.ts`
- **Source**: `packages/agent/src/routes/bots.ts:278`
- **Doc**: `website/docs/reference/architecture.md:153,368-375`
- **Fix**: Note the actual registration location

### [MEDIUM] Core types (`BotAddress`, `GroupAddress`, `Address`) completely undocumented
- **Source**: `packages/core/src/types.ts:8-20`
- **Expected doc**: `website/docs/reference/architecture.md` or `guide/concepts.md`
- **Fix**: Add "Core Types" section to architecture reference

### [MEDIUM] Potential broken internal links across docs
- **Impact**: Several files use relative links without verification
- **Fix**: Run VitePress build to catch 404s; add link validation to CI

## Low Findings (nice to have)

| Finding | Location | Fix |
|---------|----------|-----|
| Package count says "11" — actually 13 | `architecture.md:7` | Update count |
| `scheduling.md` omits concrete defaults | `scheduling.md:63` | Add "50 runs/day", "5 consecutive errors" |
| WS ticket description conflates bytes vs chars | `architecture.md:295` | Clarify "24 bytes → 32-char base64url" |
| `MECHA_SANDBOX_ROOT` description misleading | `architecture.md:635` | Clarify primary purpose is sandbox enforcement |
| Limited cross-references across all docs | All 19 files | Add "See also" sections |
| Very long files (cli.md: 1338 lines) | `cli.md`, `architecture.md` | Consider splitting |
| Missing code examples in environment.md | `environment.md` | Add `export` examples |
| `BotName`/`NodeName` branding constraints undocumented | `types.ts:2,5` | One-line note in architecture |
| Zod schemas (`BotSpawnInput` etc.) undocumented | `schemas.ts:16-43` | Brief mention for API integrators |

## Fixing Plan

Priority-ordered list of actions:

1. **Fix sessions.md command names** — Change `mecha chat` → `mecha bot chat`, `mecha sessions list` → `mecha bot sessions list`, `mecha sessions show` → `mecha bot sessions show`
2. **Fix dashboard.md port** — Replace all `3457` with `7660`
3. **Fix or remove `--no-totp`** — Either fix `validateAuthConfig()` to allow disabling TOTP, or remove `--no-totp` from cli.md
4. **Fix dashboard.md route prefixes** — Remove `/api/` from all 6 route references
5. **Fix mesh-networking.md node add example** — Add `--api-key <key>`
6. **Fix configuration.md command names** — `mecha configure` → `mecha bot configure`, `mecha spawn` → `mecha bot spawn`
7. **Fix dashboard.md heartbeat interval** — `15s` → `10s`
8. **Fix architecture.md PTY resize claim** — Remove clamping claim or add clamping code
9. **Add `MECHA_LOG_LEVEL` and `MECHA_OTP` to environment.md**
10. **Add `PermissionMode` value explanations to configuration.md**
11. **Add Core Types section to architecture.md** — `BotAddress`, `GroupAddress`, `Address`
12. **Update package count** in architecture.md

## Full Agent Reports

<details>
<summary>Staleness Report</summary>

### Freshness Score: 100/100

No stale documentation detected across all 20 code-to-doc mappings. All docs updated within 4 days of source changes.

| ID | Mapping | Source Date | Doc Date | Gap | Status |
|----|---------|-------------|----------|-----|--------|
| 1 | CLI commands → cli.md | 2026-03-03 | 2026-03-01 | 2d | Current |
| 2 | Agent → architecture.md | 2026-03-03 | 2026-03-02 | 0d | Current |
| 3 | Runtime → architecture.md | 2026-03-03 | 2026-03-02 | 0d | Current |
| 4 | ACL → permissions.md | 2026-02-28 | 2026-02-26 | 1d | Current |
| 5 | Sandbox → sandbox.md | 2026-03-01 | 2026-02-26 | 2d | Current |
| 6 | Meter → metering.md | 2026-03-02 | 2026-02-27 | 3d | Current |
| 7 | Connect → mesh-networking.md | 2026-03-02 | 2026-02-27 | 2d | Current |
| 8 | Server → mesh-networking.md | 2026-03-01 | 2026-02-27 | 1d | Current |
| 9 | schedule.ts → scheduling.md | 2026-02-25 | 2026-02-26 | 0d | Current |
| 10 | schedule CLI → scheduling.md | 2026-02-25 | 2026-02-26 | 0d | Current |
| 11 | scheduler.ts → scheduling.md | 2026-02-26 | 2026-02-26 | 0d | Current |
| 12 | MCP Server → mcp-server.md | 2026-02-28 | 2026-02-28 | 0d | Current |
| 13 | session-manager.ts → sessions.md | 2026-03-03 | 2026-02-26 | 4d | Current |
| 14 | sessions routes → sessions.md | 2026-03-03 | 2026-02-26 | 4d | Current |
| 15 | types.ts → concepts.md | 2026-02-24 | 2026-02-26 | 0d | Current |
| 16 | schemas.ts → configuration.md | 2026-02-25 | 2026-02-26 | 0d | Current |
| 17 | env.ts → environment.md | 2026-02-25 | 2026-02-27 | 0d | Current |
| 18 | bots routes → multi-agent.md | 2026-03-03 | 2026-02-26 | 4d | Current |
| 19 | Process → architecture.md | 2026-03-03 | 2026-03-02 | 0d | Current |
| 20 | SPA → dashboard.md | 2026-03-03 | 2026-02-28 | 3d | Current |

Recommendations: Add operational details to sessions.md (PTY idle timeout, scrollback buffer, control message framing).

</details>

<details>
<summary>Accuracy Report</summary>

### Accuracy Score: 0/100

12 mismatches found (3 CRITICAL, 4 HIGH, 3 MEDIUM, 2 LOW).

#### CRITICAL

1. **`mecha auth-config --no-totp` always throws** — `validateAuthConfig()` at `auth-config.ts:55-62` unconditionally throws when `config.totp` is `false`. Doc shows it as working option.

2. **`mecha dashboard serve` default port `3457` vs code `7660`** — `dashboard-serve.ts:107` uses `DEFAULTS.AGENT_PORT` (7660). Doc at `dashboard.md:11,22-23` says 3457.

3. **`sessions.md` uses non-existent commands** — `mecha chat`, `mecha sessions list`, `mecha sessions show` don't exist. Real commands are `mecha bot chat`, `mecha bot sessions list`, `mecha bot sessions show`.

#### HIGH

4. **`mecha node add` missing required `--api-key`** — `node-add.ts:13` has `.requiredOption("--api-key")`. Example at `mesh-networking.md:118` omits it.

5. **SSE heartbeat 15s vs 10s** — `events.ts:9` says `10_000`. `dashboard.md:157` says "Every 15 seconds".

6. **PTY resize clamping documented but not implemented** — `pty-manager.ts:197-201` does no bounds checking. `architecture.md:320` claims clamping.

7. **`/api/` prefix on all dashboard.md route references** — 6 routes shown with `/api/` prefix that doesn't exist in code.

#### MEDIUM

8. **`mecha configure` and `mecha spawn` in configuration.md** — Should be `mecha bot configure` and `mecha bot spawn`.

9. **`GET /auth/profiles` placed under Auth Routes** — Actually registered in `bots.ts`, not `auth.ts`.

10. **`MECHA_SANDBOX_ROOT` description misleading** — Primary purpose is sandbox enforcement, not enabling scheduler.

#### LOW

11. **Package count "11" vs actual 13** — `architecture.md:7`.

12. **WS ticket "24-byte" conflates bytes with characters** — 24 bytes encodes to 32-char base64url.

</details>

<details>
<summary>Coverage Report</summary>

### Coverage: 89% (113/127 public APIs documented)

#### Fully Covered (100%)
- CLI Commands: 78/78
- API Routes: 24/24
- Configuration Fields: 11/11

#### Gaps

| Priority | Item | Source | Expected Doc |
|----------|------|--------|-------------|
| HIGH | `MECHA_LOG_LEVEL` | `core/src/logger.ts:16` | `environment.md` |
| HIGH | `MECHA_OTP` | `core/src/totp-storage.ts:18` | `environment.md` |
| MEDIUM | `PermissionMode` values | `core/src/schemas.ts:12` | `configuration.md` |
| MEDIUM | `BotAddress` | `core/src/types.ts:8` | `architecture.md` |
| MEDIUM | `GroupAddress` | `core/src/types.ts:14` | `concepts.md` |
| MEDIUM | `Address` union | `core/src/types.ts:20` | `architecture.md` |
| LOW | `BotName` branded type | `core/src/types.ts:2` | `architecture.md` |
| LOW | `NodeName` branded type | `core/src/types.ts:5` | `architecture.md` |
| LOW | `isBotAddress()` | `core/src/types.ts:23` | `architecture.md` |
| LOW | `isGroupAddress()` | `core/src/types.ts:28` | `architecture.md` |
| LOW | `BotSpawnInput` schema | `core/src/schemas.ts:16` | `architecture.md` |
| LOW | `BotKillInput` schema | `core/src/schemas.ts:29` | `architecture.md` |
| LOW | `SessionCreateInput` schema | `core/src/schemas.ts:36` | `architecture.md` |
| LOW | `SessionMessageInput` schema | `core/src/schemas.ts:43` | `architecture.md` |

</details>

<details>
<summary>Quality Report</summary>

### Quality Score: 91/100 (avg 27.4/30 across 19 files)

#### Per-File Scores

| File | Score | Notes |
|------|-------|-------|
| reference/cli.md | 29/30 | Limited cross-references |
| reference/architecture.md | 28/30 | Dense sections (748 lines) |
| reference/environment.md | 25/30 | No code examples, sparse |
| guide/quickstart.md | 29/30 | Excellent flow |
| guide/configuration.md | 28/30 | Limited cross-references |
| guide/installation.md | 29/30 | Excellent |
| guide/concepts.md | 28/30 | Minor cross-ref gaps |
| features/permissions.md | 28/30 | Limited cross-references |
| features/sandbox.md | 27/30 | Dense |
| features/metering.md | 28/30 | Limited cross-references |
| features/mesh-networking.md | 27/30 | Dense |
| features/scheduling.md | 27/30 | Limited cross-references |
| features/mcp-server.md | 27/30 | Long (445 lines) |
| features/sessions.md | 27/30 | Limited cross-references |
| features/dashboard.md | 27/30 | Dense sections |
| features/multi-agent.md | 27/30 | Brief in places |
| advanced/multi-machine.md | 27/30 | Some duplication |
| advanced/troubleshooting.md | 28/30 | Could expand edge cases |
| index.md | 25/30 | Home page (N/A for code) |

#### Key Quality Issues
- **Cross-references**: Weakest dimension (3.4/5 avg). Most files lack "See also" sections.
- **File length**: cli.md (1338 lines), architecture.md (748 lines), mcp-server.md (445 lines) could be split.
- **environment.md**: Only file with no code examples — needs `export` command examples.

</details>
