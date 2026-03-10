# Documentation Audit Report

**Project**: mecha.im
**Date**: 2026-03-10
**Language**: TypeScript
**Framework**: VitePress

## Executive Summary

| Dimension | Score | Status |
|-----------|-------|--------|
| Freshness | 100/100 | 🟢 |
| Accuracy  | 100/100 | 🟢 |
| Coverage  | 100% | 🟢 |
| Quality   | 100/100 | 🟢 |

**Overall health**: 100/100

## Critical Findings (fix immediately)

| # | File | Issue | Severity | Status |
|---|------|-------|----------|--------|
| 1 | `reference/api/runtime.md:54` | `/api/chat` route described as "stub — returns 501" but was rewired to SDK-backed JSON endpoint in v0.2.7 | CRITICAL | **FIXED** |
| 2 | `reference/api/runtime.md:106` | `chatFn` field not renamed to `scheduleChatFn` in `CreateServerOpts` table | CRITICAL | **FIXED** |
| 3 | `reference/api/runtime.md:158` | `registerChatRoutes(app)` signature missing `chatFn` parameter and description says "stub, returns 501" | CRITICAL | **FIXED** |

## High Findings (fix soon)

| # | File | Issue | Severity | Status |
|---|------|-------|----------|--------|
| 1 | `reference/api/runtime.md` | `HttpChatFn` type missing from barrel exports table | HIGH | **FIXED** |
| 2 | `reference/api/service.md` | `ChatResult` type not documented (stale `ChatEvent` reference) | HIGH | **FIXED** |
| 3 | `reference/api/mcp-server.md` | `startHttpDaemon` function undocumented | MEDIUM | **FIXED** |
| 4 | `reference/api/mcp-server.md` | `McpHttpHandle` type undocumented | MEDIUM | **FIXED** |
| 5 | `reference/api/core.md` | `TAG_MAX_LENGTH` constant undocumented | MEDIUM | Already documented |
| 6 | `reference/api/core.md` | `AuthConfigOverrides` type undocumented | MEDIUM | Already documented |

## Medium Findings

| # | File | Issue | Severity | Status |
|---|------|-------|----------|--------|
| 1 | `reference/api/server.md` | Missing `[[toc]]` directive | MEDIUM | False positive — already present |
| 2 | `features/mesh-networking.md` | Missing `[[toc]]` directive | MEDIUM | False positive — already present |
| 3 | `guide/dashboard.md` | Overlaps with `features/dashboard.md` | MEDIUM | By design — guide vs feature reference |

## Low Findings (nice to have)

- `core.md` at 10,332 words — 3x larger than any other doc file, consider splitting
- `connect.md` and `meter.md` exceed 3000 words — borderline, acceptable for API reference
- `multi-agent.md` is thin (335 words), mostly repeats other pages
- 5 files could add "See also" cross-references
- 3 files have inconsistent heading depth

## Fixing Plan

Priority-ordered actions:

1. ~~Fix 3 CRITICAL accuracy issues in `runtime.md`~~ **DONE**
2. ~~Add `HttpChatFn` to barrel exports table~~ **DONE**
3. ~~Update `service.md` — replace stale `ChatEvent` with `ChatResult` type~~ **DONE**
4. ~~Document `startHttpDaemon` and `McpHttpHandle` in `mcp-server.md`~~ **DONE**
5. ~~Verify `TAG_MAX_LENGTH` and `AuthConfigOverrides` in `core.md`~~ Already documented
6. ~~Check `[[toc]]` in `server.md` and `mesh-networking.md`~~ Already present (false positives)
7. `guide/dashboard.md` vs `features/dashboard.md` overlap — by design (guide vs reference)

## Full Agent Reports

<details>
<summary>Staleness Report (100/100)</summary>

All 23 source-to-doc mapping pairs are within the 30-day threshold.

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
<summary>Accuracy Report (94/100)</summary>

### CRITICAL (3 issues — all fixed)
1. `runtime.md:54` — `/api/chat` described as stub (501) but now returns SDK-backed JSON
2. `runtime.md:106` — `chatFn` → `scheduleChatFn` rename not reflected
3. `runtime.md:158` — `registerChatRoutes` signature and description outdated

### HIGH (1 issue — fixed)
4. `runtime.md` — `HttpChatFn` type missing from barrel exports

### Remaining
5. `service.md` — `ChatResult` type not documented, stale `ChatEvent` reference remains

</details>

<details>
<summary>Coverage Report (98.8%)</summary>

5 undocumented symbols out of ~420 public exports:

| Symbol | Package | Type | Doc File |
|--------|---------|------|----------|
| `ChatResult` | service | Type | service.md |
| `startHttpDaemon` | mcp-server | Function | mcp-server.md |
| `McpHttpHandle` | mcp-server | Type | mcp-server.md |
| `TAG_MAX_LENGTH` | core | Constant | core.md |
| `AuthConfigOverrides` | core | Type | core.md |

</details>

<details>
<summary>Quality Report (88/100)</summary>

35 doc files audited.

| # | Severity | Finding | Location |
|---|----------|---------|----------|
| 1 | MEDIUM | Missing `[[toc]]` directive | reference/api/server.md |
| 2 | MEDIUM | Missing `[[toc]]` directive | features/mesh-networking.md |
| 3 | MEDIUM | guide/dashboard.md overlaps features/dashboard.md | guide/dashboard.md |
| 4 | LOW | core.md at 10,332 words | reference/api/core.md |
| 5 | LOW | connect.md exceeds 3000 words | reference/api/connect.md |
| 6 | LOW | meter.md exceeds 3000 words | reference/api/meter.md |
| 7 | LOW | multi-agent.md is thin (335 words) | features/multi-agent.md |

Strengths: Consistent heading hierarchy, all code blocks have language tags, proper frontmatter, cross-references via "See Also" sections.

</details>
