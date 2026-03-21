# Documentation Audit Report

**Project**: mecha.im
**Date**: 2026-03-21
**Language**: TypeScript
**Framework**: VitePress
**Threshold**: 14 days

## Executive Summary

| Dimension | Score | Status |
|-----------|-------|--------|
| Freshness | 100/100 | Pass |
| Accuracy  | 98/100 | Pass |
| Coverage  | 92%    | Good |
| Quality   | 94/100 | Pass |

**Overall health**: 96/100

## Remaining Findings

### Coverage gaps (MEDIUM)

1. **`@mecha/core` identity module** — 18 symbols (generateKeyPair, signMessage, verifySignature, createNodeIdentity, loadNodeIdentity, noise keys, etc.) exported but not in core.md
2. **`@mecha/core` discovered-node registry** — 7 symbols (readDiscoveredNodes, writeDiscoveredNode, etc.) not in core.md
3. **`@mecha/core` Tailscale scanner** — 3 symbols (parseTailscaleStatus, scanTailscalePeers) not in core.md
4. **`@mecha/service`** — `mechaAuthSwitchBot` and `mechaAuthGetDefault` have table rows but no prose sections

### Accuracy (LOW-MEDIUM)

5. **process.md** — `waitForPortFree` description says "polls every 200ms" but code does an immediate first probe
6. **workflow.md** — `depends` type notation `string[]?` conflates TypeScript optional with engine-level optional-dep `?` suffix
7. **gateway.md** — `GatewayDeniedError` for invalid URLs includes the full URL string, not a hostname

### Quality (LOW)

8. No critical or high quality issues. All 44 files have proper frontmatter, headings, intro paragraphs, and no SSR-breaking syntax.

## Fixing Plan

1. Add identity/discovered-node/tailscale sections to core.md
2. Add prose sections for mechaAuthSwitchBot, mechaAuthGetDefault in service.md
3. Fix waitForPortFree description in process.md
4. Clarify depends type notation in workflow.md
5. Fix GatewayDeniedError invalid-URL description in gateway.md
