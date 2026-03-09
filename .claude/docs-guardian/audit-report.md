# Documentation Audit Report

**Project**: mecha.im
**Date**: 2026-03-09
**Language**: TypeScript
**Framework**: VitePress

## Executive Summary

| Dimension | Score | Status |
|-----------|-------|--------|
| Freshness | 100/100 | 🟢 |
| Accuracy  | 99/100 | 🟢 |
| Coverage  | 100%    | 🟢 |
| Quality   | 95/100 | 🟢 |

**Overall health**: 98/100

## Critical Findings (fix immediately)

None.

## Medium Findings (fix soon)

1. **Missing `offClose` method in SecureChannel docs** (Accuracy)
   - File: `website/docs/reference/api/connect.md`
   - Source: `packages/connect/src/types.ts:25`
   - The `SecureChannel` interface has `offClose(handler)` in source but it's missing from the docs method table.

2. **Invalid `toSafeMessage` example** (Accuracy)
   - File: `website/docs/reference/api/core.md` (~line 329)
   - Source: `packages/core/src/errors.ts:10-18`
   - Example uses `new MechaError("bot not found", { code: "NOT_FOUND" })` but `MechaError` requires `statusCode` and `exitCode` fields too.

3. **Broken anchor link in sandbox.md** (Quality)
   - `features/sandbox.md` links to `core.md#sandbox` — no such heading exists.

4. **Broken anchor link in scheduling.md** (Quality)
   - `features/scheduling.md` links to `core.md#scheduling` — no such heading exists.

5. **Broken anchor link in permissions.md** (Quality)
   - `features/permissions.md` links to `core.md#acl` — heading is "ACL Engine" so anchor is `#acl-engine`.

6. **Broken anchor link in configuration.md** (Quality)
   - `guide/configuration.md` links to `core.md#configuration` — heading is "Settings & Config" so anchor is `#settings--config`.

## Low Findings (nice to have)

- 4 API reference pages missing `[[toc]]` directive (`runtime.md`, `process.md`, `mcp-server.md`, `node.md`)
- `service.md` missing `[[toc]]` despite 15+ headings
- `core.md` at 2748 lines — consider splitting if it grows further
- `server.md` documents `@mecha/agent` exports in "Agent Server Internals" section (cross-package)
- A few feature pages missing formal "See also" sections (`dashboard.md`)

## Fixing Plan

1. Add `offClose(handler)` to SecureChannel method table in `connect.md`
2. Fix `toSafeMessage` example in `core.md` to include all required MechaError fields
3. Fix 4 broken anchor links in `sandbox.md`, `scheduling.md`, `permissions.md`, `configuration.md`
4. Add `[[toc]]` to `runtime.md`, `process.md`, `mcp-server.md`, `node.md`, `service.md`

## Full Agent Reports

<details>
<summary>Staleness Report</summary>

**Freshness Score: 100/100**

All 23 source-to-doc pairs are within the 30-day freshness threshold. No stale documentation found.

| Source | Doc | Gap | Status |
|--------|-----|-----|--------|
| packages/core/src/** | reference/api/core.md | 0 (doc newer) | FRESH |
| packages/service/src/** | reference/api/service.md | 0 (doc newer) | FRESH |
| packages/agent/src/** | reference/api/server.md | 0.2 days | FRESH |
| packages/agent/src/** | reference/api/runtime.md | 1.8 days | FRESH |
| packages/process/src/** | reference/api/process.md | 0 (doc newer) | FRESH |
| packages/connect/src/** | reference/api/connect.md | 0 (doc newer) | FRESH |
| packages/connect/src/** | features/mesh-networking.md | 1.5 days | FRESH |
| packages/meter/src/** | reference/api/meter.md | 0 (doc newer) | FRESH |
| packages/meter/src/** | features/metering.md | 0 (doc newer) | FRESH |
| packages/mcp-server/src/** | reference/api/mcp-server.md | 0 (doc newer) | FRESH |
| packages/mcp-server/src/** | features/mcp-server.md | 0 (doc newer) | FRESH |
| packages/cli/src/** | reference/cli/index.md | 0 (doc newer) | FRESH |
| packages/cli/src/** | reference/cli/bot.md | 0 (doc newer) | FRESH |
| packages/cli/src/** | reference/cli/system.md | 0 (doc newer) | FRESH |
| packages/cli/src/** | reference/cli/node.md | 1.5 days | FRESH |
| packages/cli/src/** | reference/cli/meter.md | 1.5 days | FRESH |
| packages/cli/src/** | reference/cli/schedule.md | 1.5 days | FRESH |
| packages/cli/src/** | reference/cli/plugin.md | 1.5 days | FRESH |
| packages/spa/src/** | features/dashboard.md | 1.8 days | FRESH |
| packages/spa/src/** | guide/dashboard.md | 1.9 days | FRESH |
| packages/sandbox/src/** | features/sandbox.md | 0 (doc newer) | FRESH |
| packages/server/src/** | reference/api/server.md | 0 (doc newer) | FRESH |
| packages/runtime/src/** | reference/api/runtime.md | 1.5 days | FRESH |

Maximum gap: 1.9 days. Average gap: 0.6 days.

</details>

<details>
<summary>Accuracy Report</summary>

**Accuracy Score: 99/100**

Symbols checked: ~280. Mismatches found: 2.

**Finding 1 — MEDIUM**: Missing `offClose` method in SecureChannel docs
- connect.md lists `onClose`, `offMessage`, `onError`, `offError`, `close` but omits `offClose`
- Source: `packages/connect/src/types.ts:25`

**Finding 2 — MEDIUM**: Invalid MechaError constructor in `toSafeMessage` example
- Doc: `new MechaError("bot not found", { code: "NOT_FOUND" })`
- Code requires: `{ code, statusCode, exitCode }` (3 required fields)
- Source: `packages/core/src/errors.ts:10-18`

Verified accurate: Logger API, safeReadJson, NodeInfo, discovery types, ACL engine, schedule types, plugin registry, address types, validation, identity, all 30+ error classes, all CLI commands, server types, process types, runtime types, connect types, sandbox types, meter types, MCP server types, service layer, environment variables, bot config fields.

</details>

<details>
<summary>Coverage Report</summary>

**Coverage: 100% (457/457 symbols documented)**

| Package | Symbols | Documented | Coverage |
|---------|---------|------------|----------|
| @mecha/core | 168 | 168 | 100% |
| @mecha/service | 68 | 68 | 100% |
| @mecha/agent | 6 | 6 | 100% |
| @mecha/process | 30 | 30 | 100% |
| @mecha/connect | 53 | 53 | 100% |
| @mecha/meter | 66 | 66 | 100% |
| @mecha/mcp-server | 11 | 11 | 100% |
| @mecha/cli | 3 | 3 | 100% |
| @mecha/sandbox | 14 | 14 | 100% |
| @mecha/server | 16 | 16 | 100% |
| @mecha/runtime | 22 | 22 | 100% |

No undocumented symbols found.

</details>

<details>
<summary>Quality Report</summary>

**Quality Score: 95/100**

Files scanned: 29. Issues: 17 (0 Critical, 0 High, 4 Medium, 13 Low).

**Medium findings** (broken anchor links):
- `features/sandbox.md` → `core.md#sandbox` (no such heading)
- `features/scheduling.md` → `core.md#scheduling` (no such heading)
- `features/permissions.md` → `core.md#acl` (should be `#acl-engine`)
- `guide/configuration.md` → `core.md#configuration` (should be `#settings--config`)

**Low findings**:
- Missing `[[toc]]` in: `runtime.md`, `process.md`, `mcp-server.md`, `node.md`, `service.md`
- `core.md` at 2748 lines (near upper limit)
- `server.md` has cross-package content from `@mecha/agent`
- A few feature pages missing formal "See also" sections

All files have proper YAML frontmatter, H1 headings, heading hierarchy, code examples, formatted tables, and consistent terminology.

</details>
