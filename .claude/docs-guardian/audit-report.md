# Documentation Audit Report

**Project**: mecha.im
**Date**: 2026-03-09
**Language**: TypeScript
**Framework**: VitePress

## Executive Summary

| Dimension | Score | Status |
|-----------|-------|--------|
| Freshness | 100/100 | 🟢 |
| Accuracy  | 93/100 | 🟡 |
| Coverage  | 96.5% (effective) | 🟢 |
| Quality   | 94/100 | 🟢 |

**Overall health**: 96/100

## Critical Findings (fix immediately)

### 1. CLI flag name mismatch: `--max-budget` vs `--max-budget-usd`
- **Source**: `packages/cli/src/commands/bot-spawn.ts:32`
- **Doc**: `website/docs/reference/cli/bot.md:40,63`
- Code uses `--max-budget-usd <dollars>` but docs say `--max-budget <dollars>`. Users following the docs will use the wrong flag. The example on line 63 also uses the wrong flag.

### 2. SpawnOpts field name mismatches across process.md and service.md (8 instances)
- `maxBudget` → should be `maxBudgetUsd`
- `addDir` → should be `addDirs`
- `mcpConfig` → should be `mcpConfigFiles`
- `pluginDir` → should be `pluginDirs`
- Affects both `website/docs/reference/api/process.md` and `website/docs/reference/api/service.md`

## Medium Findings (fix soon)

### 3. Undocumented `--no-totp` option
- Missing from `mecha agent start` options table in `system.md:108-116`
- Missing from `mecha dashboard serve` options table in `system.md:527-533`
- Source: `packages/cli/src/commands/agent-start.ts:22` and `dashboard-serve.ts:110`

### 4. Missing SpawnOpts fields in process.md
- `agents` and `mcpServers` fields exist in `packages/process/src/types.ts:32-37` but are not documented in `process.md`

### 5. Incomplete BotConfig type in core.md
- Code has 30+ fields, docs show only 12. Missing: `systemPrompt`, `appendSystemPrompt`, `effort`, `maxBudgetUsd`, `allowedTools`, `disallowedTools`, `tools`, `agent`, `agents`, `sessionPersistence`, `budgetLimit`, `mcpServers`, `mcpConfigFiles`, `strictMcpConfig`, `pluginDirs`, `disableSlashCommands`, `addDirs`, `env`

### 6. Undocumented plugin error classes
- `PluginNotFoundError` and `PluginAlreadyExistsError` in `packages/core/src/plugin-registry.ts` lack documentation

## Low Findings (nice to have)

- `guide/dashboard.md` overlaps with `features/dashboard.md` — maintenance risk
- `reference/api/core.md` is ~2400 lines — consider splitting
- `reference/components.md` has duplicate "See also" entry pointing to same page
- `DASHBOARD_PORT` constant (3457) appears unused — consider removing
- 19 error constants in `core/src/errors.ts` lack JSDoc (27 siblings have them)
- 10 internal interfaces (`*RouteOpts`, `*Auth`, `*Opts`) lack JSDoc

## Fixing Plan

1. **Fix `--max-budget` → `--max-budget-usd`** in `bot.md` (table + example)
2. **Fix 4 field names** in `process.md`: `maxBudgetUsd`, `addDirs`, `mcpConfigFiles`, `pluginDirs`
3. **Fix same 4 field names** in `service.md`
4. **Add `--no-totp`** to `system.md` for both `agent start` and `dashboard serve`
5. **Add `agents` and `mcpServers`** fields to SpawnOpts table in `process.md`
6. **Expand BotConfig** in `core.md` or add cross-reference to spawn settings
7. **Add JSDoc** to `PluginNotFoundError` and `PluginAlreadyExistsError`

## Full Agent Reports

<details>
<summary>Staleness Report</summary>

### Staleness Audit — Score: 100/100

All 23 source-to-doc mapping pairs fall within the 30-day staleness threshold. Maximum observed lag: 1.9 days.

| Source | Doc | Days Behind |
|--------|-----|-------------|
| packages/spa/src | guide/dashboard.md | 1.9 |
| packages/agent/src | reference/api/runtime.md | 1.8 |
| packages/spa/src | features/dashboard.md | 1.8 |
| packages/connect/src | reference/api/connect.md | 1.5 |
| packages/connect/src | features/mesh-networking.md | 1.5 |
| packages/cli/src | reference/cli/system.md | 0.9 |
| packages/cli/src | reference/cli/node.md | 0.9 |
| packages/cli/src | reference/cli/meter.md | 0.9 |
| packages/cli/src | reference/cli/schedule.md | 0.9 |
| packages/cli/src | reference/cli/plugin.md | 0.9 |
| packages/runtime/src | reference/api/runtime.md | 0.8 |
| packages/process/src | reference/api/process.md | 0.7 |
| packages/agent/src | reference/api/server.md | 0.3 |
| packages/cli/src | reference/cli/bot.md | 0.1 |
| packages/service/src | reference/api/service.md | 0.0 |

8 of 23 pairs fully fresh (doc newer than or equal to source). Average staleness: 0.9 days.

</details>

<details>
<summary>Accuracy Report</summary>

### Accuracy Audit — Score: 93/100

187 symbols checked, 14 mismatches found.

| Severity | Count | Description |
|----------|-------|-------------|
| CRITICAL | 2 | Wrong CLI flag name + broken example |
| MAJOR | 8 | Field name mismatches (singular vs plural, shortened vs full) |
| MODERATE | 4 | Undocumented options, missing fields |
| MINOR | 1 | Unused constant |

**Root cause**: The 8 MAJOR field-name mismatches stem from docs using shortened/singular names while code uses longer/plural names. Likely written from memory or against an earlier interface version.

**Verified correct**: CLI commands (bot, system, node, meter, schedule, plugin), server API types, runtime API, agent auth, meter API, sandbox docs, formatter behavior table — all match source.

</details>

<details>
<summary>Coverage Report</summary>

### Coverage Audit — Score: 86.2% raw / 96.5% effective

806 total public symbols, 695 documented.

| Package | Symbols | Documented | Coverage |
|---------|---------|------------|----------|
| packages/connect | 61 | 61 | 100% |
| packages/mcp-server | 22 | 22 | 100% |
| packages/meter | 99 | 99 | 100% |
| packages/process | 43 | 43 | 100% |
| packages/runtime | 35 | 35 | 100% |
| packages/sandbox | 19 | 19 | 100% |
| packages/service | 91 | 91 | 100% |
| packages/server | 29 | 28 | 96.6% |
| packages/agent | 83 | 77 | 92.8% |
| packages/core | 228 | 206 | 90.4% |
| packages/cli | 96 | 14 | 14.6% |

The low CLI coverage (14.6%) is due to 80 internal `register*Command` wiring functions — the user-facing commands they register ARE fully documented. Effective public API coverage excluding internal wiring: ~96.5%.

Undocumented by severity: HIGH (2), MEDIUM (10), LOW (99).

</details>

<details>
<summary>Quality Report</summary>

### Quality Audit — Score: 94/100

38 files scanned. 4 issues found, all LOW severity.

**Strengths**:
- Complete frontmatter on every file
- Zero broken internal links
- No placeholder content (TODO, TBD, Coming soon)
- Consistent formatting and heading hierarchy
- Comprehensive code examples
- Well-formed tables throughout

**Issues**:
1. Home page (`index.md`) has no prose body content (acceptable for VitePress hero layout)
2. `guide/dashboard.md` overlaps with `features/dashboard.md`
3. `reference/api/core.md` is ~2400 lines — consider splitting
4. `reference/components.md` has duplicate "See also" link

</details>
