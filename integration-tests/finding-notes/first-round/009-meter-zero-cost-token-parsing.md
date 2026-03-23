# 009 - Meter Proxy Records Zero Cost (Token Count Parsing Failure)

## Category
07 - Metering & Budgets

## Affected Tests
7.5, 7.6, 7.7

## Severity
High - Cost tracking is non-functional

## Description

The meter proxy successfully intercepts API requests between bots and the Anthropic API, and logs events to `meter/events/<date>.jsonl`. However, all events record `inputTokens: 0`, `outputTokens: 0`, and `costUsd: 0`, even though the bot's `/api/chat` response correctly reports `costUsd` values (e.g., `0.0122436`).

## Root Cause

The `claude` CLI (spawned by the Agent SDK) sends `Accept-Encoding: gzip` in its API requests. The Anthropic API returns **compressed (gzip/brotli) responses**. The meter proxy forwards these compressed bytes to its SSE parser, which expects plaintext `data: {...}` lines but receives opaque binary — silently extracting zero tokens.

## Fix

Strip `Accept-Encoding` from upstream request headers in `buildUpstreamHeaders()` (`packages/meter/src/proxy-utils.ts`). This causes Anthropic to return uncompressed SSE that the proxy can parse.

**Branch:** `fix/meter-accept-encoding`

## Verified

After the fix, the proxy correctly extracts tokens and computes cost:
```
FINALIZE: status=200 in=3 out=39 meterDir=/home/joker/.mecha/meter
RECORDED: id=01KKBHY11NCKT83SEJ5D3Z5V6W cost=0.03613575
```

## Remaining Issue (Resolved)

The meter wrote events to `~/.mecha/meter/` instead of `~/mecha-camp/meter/` due to the MECHA_DIR split-brain issue (finding 008). Fixed by adding `export MECHA_DIR=$(pwd)` to `scripts/hotdeploy.sh` so the daemon always uses the deploy directory.

## Status

- [x] Root cause identified (compressed responses)
- [x] Fix implemented (strip Accept-Encoding)
- [x] Verified token parsing works
- [x] MECHA_DIR split-brain fixed in hotdeploy.sh
