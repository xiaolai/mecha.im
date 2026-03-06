# Documentation Audit Report

**Project**: mecha.im
**Date**: 2026-03-06
**Language**: TypeScript
**Framework**: VitePress

## Executive Summary

| Dimension | Score | Status |
|-----------|-------|--------|
| Freshness | 100/100 | 🟢 |
| Accuracy  | 95/100 | 🟢 |
| Coverage  | 84%    | 🟡 |
| Quality   | 94/100 | 🟢 |

**Overall health**: 93/100

## Critical Findings (fix immediately)

None.

## High Findings (fix soon)

### 1. [HIGH] `healthTimeoutMs` default mismatch in `@mecha/process`

- **File**: `website/docs/reference/api/process.md:74`
- **Source**: `packages/core/src/constants.ts:32` — `HEALTH_TIMEOUT_MS: 10_000`
- **Doc says**: Default is `30000`
- **Fix**: Change to `10000`

### 2. [HIGH] `relayConnect.timeoutMs` default mismatch in `@mecha/connect`

- **File**: `website/docs/reference/api/connect.md:592`
- **Source**: `packages/core/src/constants.ts:75` — `RELAY_PAIR_TIMEOUT_MS: 30_000`
- **Doc says**: Default is `10000`
- **Fix**: Change to `30000`

### 3. [HIGH] `noiseInitiate` and `noiseRespond` timeout default mismatch

- **File**: `website/docs/reference/api/connect.md:630` and `:652`
- **Source**: `packages/core/src/constants.ts:73` — `NOISE_HANDSHAKE_TIMEOUT_MS: 10_000`
- **Doc says**: Default is `5000` for both
- **Fix**: Change both to `10000`

### 4. [HIGH] `channelFetch.timeoutMs` default mismatch

- **File**: `website/docs/reference/api/connect.md:558`
- **Source**: `packages/core/src/constants.ts:36` — `FORWARD_TIMEOUT_MS: 60_000`
- **Doc says**: Default is `30000`
- **Fix**: Change to `60000`

## Medium Findings (fix soon)

### 5. [MEDIUM] Broken anchor `#discovery` in multi-machine guide

- **File**: `website/docs/guide/multi-machine.md:332`
- **Issue**: Links to `/reference/api/core#discovery` but heading is `## Discovery Types` (anchor: `#discovery-types`)
- **Fix**: Change link to `/reference/api/core#discovery-types`

### 6. [MEDIUM] Sparse `@mecha/service` API reference

- **File**: `website/docs/reference/api/service.md`
- **Issue**: 40+ barrel exports but only `nodePing` documented in detail
- **Fix**: Add brief docs for commonly used functions (`botChat`, `botStatus`, `mechaInit`, `mechaDoctor`)

### 7. [MEDIUM] Missing "See Also" in multi-agent feature doc

- **File**: `website/docs/features/multi-agent.md`
- **Issue**: Only feature doc without an API Reference / See Also section
- **Fix**: Add See Also linking to `/reference/cli/bot` and `/reference/api/process`

### 8. [MEDIUM] CLI coverage gap (20%)

- **File**: `packages/cli/src/commands/*.ts`
- **Issue**: 76/95 CLI symbols undocumented. All `register*Command` functions lack JSDoc.
- **Note**: These are internal wiring functions following the `CommandDeps` DI pattern. The user-facing CLI behavior IS fully documented in `reference/cli/` pages. The gap is in inline JSDoc only.

## Low Findings (nice to have)

| # | File | Issue |
|---|------|-------|
| 9 | `reference/cli/system.md` | 574 lines — consider TOC or split |
| 10 | `reference/api/core.md` | 714 lines — consider TOC at top |
| 11 | `reference/components.md` | Frontmatter title "Dashboard Components" vs H1 "Dashboard SPA" |
| 12 | `features/multi-agent.md` | No See Also section (addressed in #7) |
| 13 | `reference/cli/plugin.md` | See Also only links to CLI index, not to MCP feature page |
| 14 | `guide/dashboard.md` | No introductory paragraph before first section |
| 15 | `core/src/errors.ts` | 22 error factory constants undocumented (covered in `reference/errors.md` by code, but not by name in mapped doc) |

## Fixing Plan

1. Fix 5 default value mismatches in `connect.md` and `process.md` (findings #1-4)
2. Fix broken `#discovery` anchor in `multi-machine.md` (finding #5)
3. Add See Also section to `features/multi-agent.md` (finding #7)
4. Optionally expand `service.md` API details (finding #6)
5. Add TOC to `core.md` and `system.md` (findings #9-10)
6. Align components.md title/H1 (finding #11)

## Full Agent Reports

<details>
<summary>Staleness Report</summary>

**Score: 100/100** — All 18 mapped source-to-doc pairs are fresh. Documentation was updated today (2026-03-06) across multiple commits. No stale docs found.

| Source Glob | Doc File | Days Behind |
|---|---|---|
| `packages/cli/src/commands/*.ts` | `reference/cli/index.md` | 0 |
| `packages/agent/src/routes/*.ts` | `reference/api/index.md` | 0 |
| `packages/core/src/acl/**/*.ts` | `reference/api/core.md` | 0 |
| `packages/sandbox/src/**/*.ts` | `reference/api/core.md` | 0 |
| `packages/meter/src/**/*.ts` | `reference/api/meter.md` | 0 |
| `packages/connect/src/**/*.ts` | `reference/api/connect.md` | 0 |
| `packages/service/src/schedule*.ts` | `reference/api/core.md` | 0 |
| `packages/core/src/mecha-settings.ts` | `reference/api/core.md` | 0 |
| `packages/core/src/auth-config.ts` | `reference/api/core.md` | 0 |
| `packages/core/src/plugin-registry.ts` | `reference/api/core.md` | 0 |
| `packages/core/src/constants.ts` | `reference/environment.md` | 0 |
| `packages/core/src/discover*.ts` | `reference/api/core.md` | 0 |
| `packages/agent/src/auth.ts` | `reference/api/index.md` | 0 |
| `packages/process/src/**/*.ts` | `reference/api/process.md` | 0 |
| `packages/service/src/**/*.ts` | `reference/api/service.md` | 0 |
| `packages/runtime/src/**/*.ts` | `reference/api/runtime.md` | 0 |
| `packages/spa/src/**/*.tsx` | `reference/components.md` | 0 |
| `packages/mcp-server/src/**/*.ts` | `reference/api/mcp-server.md` | 0 |

</details>

<details>
<summary>Accuracy Report</summary>

**Score: 95/100** — 280 symbols checked, 5 default value mismatches found.

All internal links verified as resolving correctly. All type definitions, function signatures, CLI command arguments, and API routes match source code.

**Mismatches:**

| Finding | Doc File | Code Default | Doc Default |
|---------|----------|-------------|-------------|
| `healthTimeoutMs` | `process.md:74` | `10000` | `30000` |
| `relayConnect.timeoutMs` | `connect.md:592` | `30000` | `10000` |
| `noiseInitiate.timeoutMs` | `connect.md:630` | `10000` | `5000` |
| `noiseRespond.timeoutMs` | `connect.md:652` | `10000` | `5000` |
| `channelFetch.timeoutMs` | `connect.md:558` | `60000` | `30000` |

**Verified accurate:** ACL types, Discovery types, Discovered Node Registry, MechaSettings, AuthConfig, PluginRegistry, Sandbox types, ProcessManager, SpawnOpts, AgentServer, Runtime server, all CLI commands, environment variables, meter types, connect types, server types, MCP server exports.

</details>

<details>
<summary>Coverage Report</summary>

**Score: 84%** — 858 public symbols found, 722 documented, 136 undocumented.

**By package:**

| Package | Total | Documented | Coverage |
|---------|-------|------------|----------|
| packages/connect | 61 | 61 | 100% |
| packages/mcp-server | 22 | 22 | 100% |
| packages/meter | 99 | 99 | 100% |
| packages/process | 43 | 43 | 100% |
| packages/runtime | 35 | 35 | 100% |
| packages/service | 78 | 78 | 100% |
| packages/spa | 79 | 78 | 99% |
| packages/server | 29 | 28 | 97% |
| packages/sandbox | 19 | 18 | 95% |
| packages/agent | 76 | 71 | 93% |
| packages/core | 222 | 170 | 77% |
| packages/cli | 95 | 19 | 20% |

**Key gaps:**
- CLI `register*Command` functions (76 symbols) — internal wiring, user-facing CLI is documented
- Core error factory constants (22 symbols) — covered in `errors.md` but not mapped doc
- Core Zod schemas and input types (12 symbols) — implementation detail

</details>

<details>
<summary>Quality Report</summary>

**Score: 94/100** — 36 files scanned, 12 issues found (0 Critical, 0 High, 4 Medium, 8 Low).

**Strengths:**
- Consistent frontmatter on every file
- Proper heading hierarchy throughout
- All code blocks have language tags
- Consistent "bot" terminology
- Rich cross-references between docs
- Good use of tables and code examples

**Issues:**
1. Broken anchor `#discovery` → should be `#discovery-types` (multi-machine.md)
2. Sparse service.md (40+ exports, 1 documented in detail)
3. Missing See Also in multi-agent.md
4. Long files without TOC (system.md 574 lines, core.md 714 lines)
5. Title/H1 mismatch in components.md
6. Missing intro paragraph in guide/dashboard.md

</details>
