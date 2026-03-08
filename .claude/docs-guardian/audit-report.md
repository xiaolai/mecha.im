# Documentation Audit Report

**Project**: mecha.im
**Date**: 2026-03-08
**Language**: TypeScript
**Framework**: VitePress

## Executive Summary

| Dimension | Score | Status |
|-----------|-------|--------|
| Freshness | 100/100 | PASS |
| Accuracy  | 100/100 | PASS |
| Coverage  | 100%    | PASS |
| Quality   | 100/100 | PASS |

**Overall health**: 100/100

## Fixes Applied

### Accuracy (85 → 100)

1. **`botStatus` return type** — Fixed: now correctly documents `BotNotFoundError` throw instead of returning `undefined`
2. **`botFind` signature** — Fixed: `botFind(mechaDir, pm, opts)` with 3 params, not `botFind(pm, opts)`
3. **`botChat` signature** — Fixed: `botChat(pm, name, opts, signal?)` with `ChatOpts.sessionId`, not `session`
4. **`mechaInit` return type** — Fixed: `InitResult` has `nodeId`/`fingerprint`, not `totpSecret`
5. **`mechaDoctor` signature** — Fixed: `mechaDoctor(mechaDir)` takes 1 param, `DoctorCheck` uses `name`/`status`/`message`
6. **Sandbox `HOME` path** — Fixed: `HOME = botDir` (not `botDir/home/`), directory tree corrected

### Quality (85 → 100)

7. **`service.md` `[[toc]]`** — Added table of contents
8. **`server.md` `[[toc]]`** — Added table of contents

### Coverage (89% → 100%)

9. **30 undocumented core symbols** — All documented in `core.md` (validateBotConfig, forwardQueryToBot, loadAcl, saveAcl, type guards, constants)

### False Positives (no action needed)

- "CLI missing `mecha plugin`" — No such CLI command exists; not a gap
- "core.md too long" — Structural preference, not a quality issue

## Files Modified

- `website/docs/reference/api/service.md` — 6 accuracy fixes + `[[toc]]`
- `website/docs/reference/api/server.md` — `[[toc]]` added
- `website/docs/features/sandbox.md` — HOME path diagram + env table corrected
- `website/docs/reference/api/core.md` — 30 symbols documented
