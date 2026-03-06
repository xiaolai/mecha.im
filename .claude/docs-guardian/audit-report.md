# Documentation Audit Report

**Project**: mecha.im
**Date**: 2026-03-06
**Language**: TypeScript
**Framework**: VitePress

## Executive Summary

| Dimension | Score | Status |
|-----------|-------|--------|
| Freshness | 73/100 | yellow |
| Accuracy  | 94/100 | green |
| Coverage  | 93%    | green |
| Quality   | 97/100 | green |

**Overall health: 89/100**

## Critical Findings (fix immediately)

### 1. `dashboard.md` is untracked in git (Freshness - CRITICAL)

**File:** `website/docs/guide/dashboard.md`

The dashboard documentation (27KB, 766 lines, 128 symbols) exists on disk but has **never been committed to git**. It will be lost if the working tree is cleaned.

**Fix:** `git add website/docs/guide/dashboard.md` and commit.

### 2. Meter snapshot interval mismatch (Accuracy - HIGH)

**File:** `website/docs/features/metering.md:143`
**Source:** `packages/core/src/constants.ts:48`

- Doc says: `Snapshot interval | 5s`
- Code says: `METER_SNAPSHOT_INTERVAL_MS: 10_000` (10 seconds)

**Fix:** Update the doc table to show `10s`.

### 3. Route summary table missing ~28 routes (Accuracy - HIGH)

**File:** `website/docs/reference/architecture.md:150-193`

The route summary table lists 35 routes but the agent registers ~63. Missing routes include: budgets, meter start/stop, audit clear, ACL grant/revoke, schedule CRUD, bot delete/logs/sandbox, doctor, settings endpoints, and discover handshake.

**Fix:** Add all registered routes to the summary table.

## Medium Findings (fix soon)

### 4. Broken anchor link in configuration.md (Quality - MEDIUM)

**File:** `website/docs/guide/configuration.md:244`

`[ACL capabilities](#capabilities)` links to a nonexistent heading. Should be `[ACL capabilities](/features/permissions#capabilities)`.

### 5. Duplicate discovery types across two docs (Quality - MEDIUM)

`DiscoverableEntry`, `DiscoveryFilter`, `DiscoveryIndex` etc. are fully documented in both `mesh-networking.md` and `multi-machine.md`. One should reference the other.

### 6. `fetchPublicIp` barrel export missing (Accuracy - LOW)

`architecture.md` shows `import { fetchPublicIp } from "@mecha/agent"` but the barrel `index.ts` doesn't re-export it. Either add the re-export or change the doc to `from "@mecha/core"`.

### 7. 4 source mapping globs match no files (Freshness)

These mapping patterns in `docs-guardian/config.json` need updating:
- `packages/core/src/sandbox*.ts` (sandbox is in `packages/sandbox/`)
- `packages/core/src/mesh*.ts` (mesh is in `packages/connect/`)
- `packages/core/src/config*.ts` (no files match)
- `packages/core/src/env*.ts` (no files match)

## Low Findings (nice to have)

- **Long reference files**: `architecture.md` (1644 lines), `mesh-networking.md` (1197 lines), `metering.md` (974 lines), `cli.md` (1426 lines) could benefit from splitting into sub-pages
- **dashboard.md lacks screenshots**: GUI documentation would benefit from visual aids
- **Error message docs simplified**: `ForwardingError` and `ProcessHealthTimeoutError` docs don't show full message text with guidance hints
- **59 remaining undocumented symbols**: Mostly in `core/src/errors.ts` (21 error constants), `core/src/schedule.ts` (9 Zod schemas), and identity modules

## Fixing Plan

1. **Commit all new/updated doc files** (especially `dashboard.md`)
2. Fix metering snapshot interval: `5s` -> `10s` in `metering.md:143`
3. Add missing routes to architecture route summary table
4. Fix broken `#capabilities` anchor in `configuration.md:244`
5. Deduplicate discovery types between `mesh-networking.md` and `multi-machine.md`
6. Fix `fetchPublicIp` import path in `architecture.md`
7. Update `docs-guardian/config.json` mapping globs to match actual file locations

## Detailed Scores

### Freshness: 73/100

| Source | Doc | Gap | Status |
|--------|-----|-----|--------|
| `packages/spa/src/**/*.tsx` | `guide/dashboard.md` | UNTRACKED | CRITICAL |
| `packages/agent/src/routes/*.ts` | `reference/architecture.md` | 10.2h | FRESH |
| `packages/cli/src/commands/*.ts` | `reference/cli.md` | 10.2h | FRESH |
| `packages/agent/src/auth.ts` | `guide/configuration.md` | 10.2h | FRESH |
| `packages/service/src/**/*.ts` | `reference/architecture.md` | 4.1h | FRESH |
| All other pairs | Various | 0h | FRESH |

### Accuracy: 94/100

- 142 symbols cross-referenced
- 8 mismatches found (1 HIGH numeric, 1 HIGH completeness, 2 MEDIUM, 4 LOW)

### Coverage: 93% (800/859 symbols)

| Package | Coverage |
|---------|----------|
| connect | 100% |
| mcp-server | 100% |
| meter | 100% |
| process | 100% |
| runtime | 100% |
| sandbox | 100% |
| service | 100% |
| spa | 99% |
| agent | 99% |
| cli | 98% |
| server | 97% |
| core | 76% |

Previous: 47% (524/1116) -> Current: 93% (800/859)

### Quality: 97.4/100

| File | Score |
|------|-------|
| `reference/errors.md` | 100 |
| `features/permissions.md` | 100 |
| `features/scheduling.md` | 100 |
| `reference/environment.md` | 99 |
| `features/sandbox.md` | 99 |
| `reference/cli.md` | 97 |
| `features/metering.md` | 97 |
| `guide/dashboard.md` | 97 |
| `guide/configuration.md` | 96 |
| `features/mesh-networking.md` | 96 |
| `advanced/multi-machine.md` | 95 |
| `reference/architecture.md` | 93 |
