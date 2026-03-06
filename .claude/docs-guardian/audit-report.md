# Documentation Audit Report

**Project**: mecha.im
**Date**: 2026-03-06
**Language**: TypeScript
**Framework**: VitePress
**Branch**: feat/dashboard-gap-coverage

## Executive Summary

| Dimension | Score | Status |
|-----------|-------|--------|
| Freshness | 100/100 | FRESH |
| Accuracy  | 40/100 | CRITICAL |
| Coverage  | 93% | GOOD |
| Quality   | 97/100 | GOOD |

**Overall health**: 72/100

> Accuracy score is heavily penalized by 2 CRITICAL findings (broken quickstart example, non-functional `--no-totp` flag). Fixing those + 1 HIGH would raise accuracy to 90/100 and overall health to ~95/100.

---

## Critical Findings (fix immediately)

### 1. [CRITICAL] Quickstart budget command missing required scope

- **Doc**: `website/docs/guide/quickstart.md:103`
- **Code**: `packages/cli/src/commands/budget.ts:41-53`
- **Issue**: `mecha budget set --daily 5.00` will error — requires `[name]`, `--global`, `--auth`, or `--tag`
- **Fix**: Change to `mecha budget set --global --daily 5.00` or `mecha budget set researcher --daily 5.00`

### 2. [CRITICAL] `--no-totp` flag documented but always throws

- **Doc**: `website/docs/reference/cli/system.md:29,117,537`
- **Code**: `packages/core/src/auth-config.ts:55-61`
- **Issue**: `--no-totp` is documented on `mecha start`, `mecha agent start`, and `mecha dashboard serve`, but `validateAuthConfig` always throws `"TOTP must be enabled"` when totp is false
- **Fix**: Either remove the validation throw to make the flag work, or remove `--no-totp` from CLI and docs

### 3. [HIGH] Schedule API routes use `:scheduleId` but docs say `:id`

- **Doc**: `website/docs/reference/api/index.md:64-68`
- **Code**: `packages/agent/src/routes/schedules.ts:63,70,77,84,90`
- **Issue**: Docs show `DELETE /bots/:name/schedules/:id` etc. but code uses `:scheduleId`
- **Fix**: Update 5 route paths in docs to use `:scheduleId`

### 4. [HIGH] 5 timeout default mismatches in connect.md and process.md

| Finding | Doc File | Code Default | Doc Default |
|---------|----------|-------------|-------------|
| `healthTimeoutMs` | `process.md:74` | `10000` | `30000` |
| `relayConnect.timeoutMs` | `connect.md:592` | `30000` | `10000` |
| `noiseInitiate.timeoutMs` | `connect.md:630` | `10000` | `5000` |
| `noiseRespond.timeoutMs` | `connect.md:652` | `10000` | `5000` |
| `channelFetch.timeoutMs` | `connect.md:558` | `60000` | `30000` |

---

## Medium Findings (fix soon)

### 5. [MEDIUM] Metering snapshot interval: doc says 10s, code uses 5s

- **Doc**: `website/docs/features/metering.md:143`
- **Code**: `packages/meter/src/daemon.ts:123`
- **Issue**: Doc says "Snapshot interval: 10s" but daemon hardcodes `5_000`. `DEFAULTS.METER_SNAPSHOT_INTERVAL_MS` is `10_000` but unused.
- **Fix**: Update doc to 5s AND fix daemon to use the constant

### 6. [MEDIUM] 13 doc pages missing `[[toc]]` directive

Long pages (>100 lines, >5 headings) without table of contents:

| File | Lines | Headings |
|------|-------|----------|
| `reference/components.md` | 772 | 47 |
| `reference/api/meter.md` | 823 | 29 |
| `reference/api/connect.md` | 804 | 25 |
| `features/mesh-networking.md` | 344 | 19 |
| `guide/multi-machine.md` | 333 | 18 |
| `features/mcp-server.md` | 328 | 22 |
| `features/dashboard.md` | 287 | 20 |
| `reference/cli/bot.md` | 340 | 16 |
| `reference/errors.md` | 222 | 18 |
| `features/sandbox.md` | 193 | 15 |
| `guide/concepts.md` | 188 | 14 |
| `features/metering.md` | 168 | 11 |

(Only `reference/cli/system.md` and `reference/api/core.md` currently have `[[toc]]`)

### 7. [MEDIUM] 4 doc files exceed 500-line recommended max

| File | Lines |
|------|-------|
| `reference/api/meter.md` | 823 |
| `reference/api/connect.md` | 804 |
| `reference/components.md` | 772 |
| `reference/api/core.md` | 717 |

### 8. [MEDIUM] 32 undocumented public symbols in @mecha/core

Gap concentrated in `website/docs/reference/api/core.md`:

| Category | Count | Key symbols |
|----------|-------|-------------|
| Identity (keys, signing, noise) | 15 | `generateKeyPair`, `signMessage`, `loadNodeIdentity`, `createNoiseKeys` |
| Auth resolution | 11 | `resolveAuth`, `readAuthProfiles`, `listAuthProfiles`, `AuthProfileMeta` |
| Address/validation | 10 | `botName`, `parseAddress`, `isValidName`, `validateTags` |
| Node registry | 6 | `readNodes`, `addNode`, `removeNode`, `NodeEntry` |
| Bot config | 5 | `readBotConfig`, `updateBotConfig`, `BotConfig` |
| Server state | 4 | `readServerState`, `writeServerState` |
| TOTP storage | 4 | `readTotpSecret`, `generateTotpSecret` |
| Tailscale scanner | 3 | `parseTailscaleStatus`, `scanTailscalePeers` |
| Zod schemas | 10 | `BotSpawnInput`, `ScheduleEntrySchema`, `PermissionMode` |
| Forwarding/mapping | 3 | `forwardQueryToBot`, `toUserMessage`, `toSafeMessage` |

### 9. [MEDIUM] Broken anchor in multi-machine guide

- **File**: `website/docs/guide/multi-machine.md:332`
- **Issue**: Links to `/reference/api/core#discovery` but heading anchor is `#discovery-types`

---

## Low Findings (nice to have)

| # | File | Issue |
|---|------|-------|
| 10 | `website/docs/index.md` | Missing `title`/`description` frontmatter for SEO |
| 11 | `website/docs/guide/dashboard.md` | Short page (48 lines), thin for a guide |
| 12 | `website/docs/reference/api/index.md:197` | "See Also" self-links back to current page |
| 13 | `website/docs/reference/components.md` | Frontmatter title "Dashboard Components" vs H1 "Dashboard SPA" |
| 14 | 3 sandbox platform functions | `generateSbpl`, `escapeSbpl`, `writeProfileMacos` undocumented (internal) |
| 15 | 3 CLI barrel exports | `createFormatter`, `createProgram`, `Formatter` undocumented (internal) |
| 16 | 22 core constants/type guards | `DEFAULTS`, `NAME_PATTERN`, `isBotAddress` etc. (self-documenting) |

---

## Fixing Plan

Priority-ordered:

1. **Fix quickstart budget example** — Add `--global` flag in quickstart.md (Critical #1)
2. **Fix `--no-totp` docs** — Remove from 3 locations in system.md OR remove validation throw (Critical #2)
3. **Fix schedule route params** — Replace `:id` with `:scheduleId` in 5 routes in api/index.md (High #3)
4. **Fix 5 timeout defaults** — Update connect.md and process.md to match constants.ts (High #4)
5. **Fix meter snapshot interval** — Update metering.md to 5s, fix daemon.ts to use constant (Medium #5)
6. **Fix broken anchor** — `#discovery` → `#discovery-types` in multi-machine.md (Medium #9)
7. **Add `[[toc]]` to 12 long pages** — One-liner after frontmatter (Medium #6)
8. **Document @mecha/core gaps** — Add Identity, Auth, Address sections to core.md (Medium #8)
9. **Consider splitting over-length files** — meter.md, connect.md, components.md (Medium #7)

---

## Full Agent Reports

<details>
<summary>Staleness Report (Score: 100/100)</summary>

All 26 mapped doc pairs are FRESH. Every doc file was updated on 2026-03-06, same day as or after the most recent source code changes.

| Source | Doc | Status |
|--------|-----|--------|
| packages/cli/src/commands/*.ts | reference/cli/index.md | FRESH |
| packages/agent/src/routes/*.ts | reference/api/index.md | FRESH |
| packages/core/src/acl/**/*.ts | reference/api/core.md | FRESH |
| packages/sandbox/src/**/*.ts | reference/api/core.md | FRESH |
| packages/meter/src/**/*.ts | reference/api/meter.md | FRESH |
| packages/connect/src/**/*.ts | reference/api/connect.md | FRESH |
| packages/service/src/schedule*.ts | reference/api/core.md | FRESH |
| packages/core/src/mecha-settings.ts | reference/api/core.md | FRESH |
| packages/core/src/auth-config.ts | reference/api/core.md | FRESH |
| packages/core/src/plugin-registry.ts | reference/api/core.md | FRESH |
| packages/core/src/constants.ts | reference/environment.md | FRESH |
| packages/core/src/discover*.ts | reference/api/core.md | FRESH |
| packages/agent/src/auth.ts | reference/api/index.md | FRESH |
| packages/process/src/**/*.ts | reference/api/process.md | FRESH |
| packages/service/src/**/*.ts | reference/api/service.md | FRESH |
| packages/runtime/src/**/*.ts | reference/api/runtime.md | FRESH |
| packages/spa/src/**/*.tsx | reference/components.md | FRESH |
| packages/mcp-server/src/**/*.ts | reference/api/mcp-server.md | FRESH |
| packages/meter/src/ | features/metering.md | FRESH |
| packages/connect/src/ | features/mesh-networking.md | FRESH |
| packages/core/src/acl/ | features/permissions.md | FRESH |
| packages/sandbox/src/ | features/sandbox.md | FRESH |
| packages/service/src/schedule*.ts | features/scheduling.md | FRESH |
| packages/runtime/src/ | features/sessions.md | FRESH |
| packages/mcp-server/src/ | features/mcp-server.md | FRESH |
| packages/spa/src/ | features/dashboard.md | FRESH |

</details>

<details>
<summary>Accuracy Report (Score: 40/100)</summary>

**Findings**: 2 CRITICAL, 1 HIGH (route params), 1 HIGH (5 timeout defaults), 2 MEDIUM

Score penalized by CRITICALs. 142+ symbols verified correct including all CLI commands, API routes, ACL capabilities, sandbox modes, environment variables, and default ports.

**Verified accurate**: All bot commands, schedule commands, node commands, meter commands, plugin commands, acl commands, auth commands, mcp serve, audit commands, sandbox show. 60+ API routes match. All env vars match. Ports (7660, 7600, 7680) match.

</details>

<details>
<summary>Coverage Report (Score: 93%)</summary>

499 of 537 public symbols documented.

| Package | Total | Documented | Coverage |
|---------|-------|------------|----------|
| @mecha/core | 139 | 107 | 77% |
| @mecha/service | 51 | 51 | 100% |
| @mecha/process | 37 | 37 | 100% |
| @mecha/sandbox | 15 | 12 | 80% |
| @mecha/connect | 46 | 46 | 100% |
| @mecha/meter | 67 | 67 | 100% |
| @mecha/server | 18 | 18 | 100% |
| @mecha/mcp-server | 13 | 13 | 100% |
| @mecha/agent | 6 | 6 | 100% |
| @mecha/runtime | 24 | 24 | 100% |
| CLI commands | 70 | 70 | 100% |
| SPA components | 48 | 48 | 100% |

Undocumented severity: 52 HIGH (public functions), 34 MEDIUM (types/interfaces), 22 LOW (constants)

</details>

<details>
<summary>Quality Report (Score: 97/100)</summary>

37 files scanned. 20 issues: 0 HIGH, 17 MEDIUM, 3 LOW.

**Strengths**: Proper frontmatter (36/37), correct heading hierarchy, all code blocks tagged, no broken links, zero TODOs, consistent structure, rich examples.

**Issues**: 13 pages missing `[[toc]]`, 4 over-length files, home page SEO, dashboard guide thin, API index self-link.

</details>
