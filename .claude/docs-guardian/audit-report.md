# Documentation Audit Report

**Project**: mecha.im
**Date**: 2026-03-09
**Language**: TypeScript
**Framework**: VitePress

## Executive Summary

| Dimension | Score | Status |
|-----------|-------|--------|
| Freshness | 100/100 | 🟢 |
| Accuracy  | 98/100 | 🟡 |
| Coverage  | 90%    | 🟡 |
| Quality   | 90/100 | 🟡 |

**Overall health**: 94/100

## Critical Findings (fix immediately)

No critical findings.

## Medium Findings (fix soon)

1. **[MEDIUM] Missing SpawnOpts fields in process.md and service.md** — `dangerouslySkipPermissions`, `allowDangerouslySkipPermissions`, and `fallbackModel` fields are present in SpawnOpts but not documented in `website/docs/reference/api/process.md` or `website/docs/reference/api/service.md`.

2. **[MEDIUM] SPA package at 21% coverage** — 62 React component exports in `packages/spa/src/` lack JSDoc documentation. Components include: MechaChat, LogViewer, SessionList, BotCard, MeshMap, and many others.

3. **[MEDIUM] Core package at 92% coverage** — 18 error factory constants in `packages/core/src/errors.ts` still lack JSDoc.

## Low Findings (nice to have)

1. **[LOW] Missing `[[toc]]` directive** — 9 documentation pages missing table of contents: `sandbox.md`, `mesh-networking.md`, `metering.md`, `multi-machine.md`, `api/runtime.md`, `api/server.md`, `api/process.md`, `api/service.md`, `cli/meter.md`.

2. **[LOW] Untagged code blocks** — 24 fenced code blocks across documentation pages missing language tags (e.g., ` ```bash `, ` ```json `).

3. **[LOW] Thin page** — `website/docs/reference/cli/plugin.md` has minimal content that could be expanded.

## Fixing Plan

Priority-ordered list of actions:
1. Add missing SpawnOpts fields to process.md and service.md docs
2. Add JSDoc to 62 SPA component exports
3. Add JSDoc to 18 remaining core error constants
4. Add `[[toc]]` to 9 pages
5. Tag 24 untagged code blocks

## Full Agent Reports

<details>
<summary>Staleness Report</summary>

**Freshness Score: 100/100**

All source-to-doc pairs are within the 30-day freshness threshold. No stale documentation found.

</details>

<details>
<summary>Accuracy Report</summary>

**Accuracy Score: 98/100**

| # | Severity | Finding | Location | Recommendation |
|---|----------|---------|----------|----------------|
| 1 | MEDIUM | Missing `dangerouslySkipPermissions` field | process.md, service.md | Add field to SpawnOpts table |
| 2 | MEDIUM | Missing `allowDangerouslySkipPermissions` field | process.md, service.md | Add field to SpawnOpts table |
| 3 | MEDIUM | Missing `fallbackModel` field | process.md, service.md | Add field to SpawnOpts table |

</details>

<details>
<summary>Coverage Report</summary>

**Coverage: 90% (backend 100%, SPA 21%)**

| Package | Documented | Total | Coverage |
|---------|-----------|-------|----------|
| core | 170 | 185 | 92% |
| cli | 82 | 82 | 100% |
| agent | 45 | 45 | 100% |
| process | 38 | 38 | 100% |
| meter | 22 | 22 | 100% |
| sandbox | 12 | 12 | 100% |
| service | 8 | 8 | 100% |
| spa | 16 | 78 | 21% |

62 undocumented SPA component exports + 18 core error constants = 80 symbols remaining.

</details>

<details>
<summary>Quality Report</summary>

**Quality Score: 90/100**

| # | Severity | Finding | Location |
|---|----------|---------|----------|
| 1 | LOW | Missing `[[toc]]` | 9 pages |
| 2 | LOW | Untagged code blocks | 24 blocks across multiple pages |
| 3 | LOW | Thin page | cli/plugin.md |

</details>
