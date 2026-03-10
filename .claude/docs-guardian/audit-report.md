# Documentation Audit Report

**Project**: mecha.im
**Date**: 2026-03-10
**Language**: TypeScript
**Framework**: VitePress

## Executive Summary

| Dimension | Score | Status |
|-----------|-------|--------|
| Freshness | 100/100 | 🟢 |
| Accuracy  | 97/100 | 🟢 |
| Coverage  | 99%    | 🟢 |
| Quality   | 93/100 | 🟢 |

**Overall health**: 97/100

## Critical Findings (fix immediately)

1. **[CRITICAL] `version("0.2.0")` hardcoded in CLI index docs** — `reference/cli/index.md:66` says `version("0.2.0")` but actual version is `0.2.4`. **FIXED**: Changed to "version read from `package.json`" to prevent future drift.

2. **[CRITICAL] `--no-totp` documented for `dashboard serve` but removed from code** — `reference/cli/system.md:565` lists `--no-totp` option that no longer exists (removed in audit fix commit `07b6d52`). **FIXED**: Removed from docs.

## Medium Findings (fix soon)

1. **[MEDIUM] Quickstart uses `--cron` flag that doesn't exist** — `guide/quickstart.md:123` shows `mecha schedule add researcher --cron "0 9 * * *"` but the CLI uses `--id` + `--every`. **FIXED**: Updated to `--id daily-papers --every 24h`.

2. **[MEDIUM] `node add --api-key` not clearly marked as required** — `reference/cli/node.md:45` lists it as a regular option but code uses `requiredOption()`. **FIXED**: Added Required column.

3. **[MEDIUM] `guide/dashboard.md` overlaps with `features/dashboard.md`** — Two pages with same title, thin guide page (191 words) duplicates feature page content. Consider consolidating or cross-linking.

## Low Findings (nice to have)

1. **[LOW] `core.md` at 10,332 words** — 3x larger than any other doc file, covers 10+ domains. Consider splitting.
2. **[LOW] `connect.md` and `meter.md` exceed 3000 words** — Borderline, acceptable for API reference.
3. **[LOW] `multi-agent.md` is thin** — 335 words, mostly repeats other pages.
4. **[LOW] `SPA_VERSION` undocumented** — Auto-generated build constant in `spa-embedded.generated.ts`. Not user-facing.

## Fixing Plan

Priority-ordered actions:
1. ~~Fix hardcoded version in index.md~~ ✅ Done
2. ~~Remove phantom `--no-totp` from system.md~~ ✅ Done
3. ~~Fix `--cron` example in quickstart.md~~ ✅ Done
4. ~~Mark `--api-key` as required in node.md~~ ✅ Done
5. Consolidate or cross-link guide/dashboard.md ↔ features/dashboard.md
6. Consider splitting core.md into domain-specific pages

## Full Agent Reports

<details>
<summary>Staleness Report (100/100)</summary>

All 24 source-to-doc mapping pairs are within the 30-day threshold. Maximum lag: 2.8 days (meter API doc). The entire documentation set was updated within the last 4 days.

| Source Package | Worst Lag | Status |
|---|---|---|
| packages/core/src | 0 days | FRESH |
| packages/cli/src | 0.9 days | FRESH |
| packages/agent/src | 1.3 days | FRESH |
| packages/meter/src | 2.8 days | FRESH |
| packages/service/src | 0 days | FRESH |
| packages/connect/src | 0 days | FRESH |
| packages/process/src | 0.3 days | FRESH |
| packages/mcp-server/src | 0.4 days | FRESH |
| packages/server/src | 1.3 days | FRESH |
| packages/runtime/src | 0 days | FRESH |
| packages/sandbox/src | 0 days | FRESH |
| packages/spa/src | 0.1 days | FRESH |

</details>

<details>
<summary>Accuracy Report (97/100)</summary>

87 symbols checked across CLI commands, options, types, interfaces, and formatter methods.

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| 1 | CRITICAL | `version("0.2.0")` hardcoded in index.md (actual: 0.2.4) | FIXED |
| 2 | CRITICAL | `--no-totp` listed for `dashboard serve` but removed from code | FIXED |
| 3 | MEDIUM | `node add --api-key` is requiredOption but not visually distinguished | FIXED |
| 4 | MEDIUM | Quickstart `--cron` flag doesn't exist (should be `--id` + `--every`) | FIXED |

30+ verified-correct items including all bot spawn options, meter/schedule/node commands, formatter interface, and CommandDeps type.

</details>

<details>
<summary>Coverage Report (99%)</summary>

822 public symbols across 11 packages. 821 documented.

| Package | Symbols | Documented | Coverage |
|---------|---------|------------|----------|
| core | 230 | 230 | 100% |
| cli | 107 | 106 | 99% |
| agent | 83 | 83 | 100% |
| service | 91 | 91 | 100% |
| meter | 99 | 99 | 100% |
| connect | 61 | 61 | 100% |
| process | 44 | 44 | 100% |
| runtime | 35 | 35 | 100% |
| server | 29 | 29 | 100% |
| mcp-server | 24 | 24 | 100% |
| sandbox | 19 | 19 | 100% |

1 undocumented symbol: `SPA_VERSION` in auto-generated file (LOW, no action needed).

</details>

<details>
<summary>Quality Report (93/100)</summary>

35 doc files audited.

| # | Severity | Finding | Location |
|---|----------|---------|----------|
| 1 | MEDIUM | guide/dashboard.md overlaps features/dashboard.md | guide/dashboard.md |
| 2 | LOW | core.md at 10,332 words | reference/api/core.md |
| 3 | LOW | connect.md exceeds 3000 words | reference/api/connect.md |
| 4 | LOW | meter.md exceeds 3000 words | reference/api/meter.md |
| 5 | LOW | multi-agent.md is thin (335 words) | features/multi-agent.md |

Strengths: Consistent heading hierarchy, all code blocks have language tags, proper frontmatter, cross-references via "See Also" sections.

</details>
