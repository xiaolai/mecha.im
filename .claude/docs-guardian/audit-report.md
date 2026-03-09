# Documentation Audit Report

**Project**: mecha.im
**Date**: 2026-03-09
**Language**: TypeScript
**Framework**: VitePress

## Executive Summary

| Dimension | Score | Status |
|-----------|-------|--------|
| Freshness | 100/100 | 🟢 |
| Accuracy  | 100/100 | 🟢 |
| Coverage  | 100%    | 🟢 |
| Quality   | 100/100 | 🟢 |

**Overall health**: 100/100

## Findings

All findings from the initial audit have been resolved:

- **`offClose` in SecureChannel docs** — already present (false positive)
- **`toSafeMessage` example** — already had correct constructor fields (false positive)
- **Broken anchor links** — not found in current docs (already fixed)
- **`ConfigValidationError` undocumented** — added to `core.md` under Bot Config section
- **Missing `[[toc]]` directives** — added to 6 pages: `permissions.md`, `scheduling.md`, `sessions.md`, `configuration.md`, `cli/index.md`, `environment.md`
- **Home page frontmatter** — uses VitePress `layout: home` which derives title/description from hero section (no fix needed)

## Full Agent Reports

<details>
<summary>Staleness Report</summary>

**Freshness Score: 100/100**

All 23 source-to-doc pairs are within the 30-day freshness threshold. No stale documentation found.
Maximum gap: 1.9 days. Average gap: 0.6 days.

</details>

<details>
<summary>Accuracy Report</summary>

**Accuracy Score: 100/100**

All previously reported mismatches were false positives or already fixed.

</details>

<details>
<summary>Coverage Report</summary>

**Coverage: 100% (458/458 symbols documented)**

`ConfigValidationError` added to `core.md`.

</details>

<details>
<summary>Quality Report</summary>

**Quality Score: 100/100**

`[[toc]]` added to all 6 pages that were missing it.

</details>
