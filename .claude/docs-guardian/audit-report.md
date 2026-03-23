# Documentation Audit Report

**Project**: mecha.im
**Date**: 2026-03-23
**Language**: TypeScript
**Framework**: VitePress

## Executive Summary

| Dimension | Score | Status |
|-----------|-------|--------|
| Freshness | 100/100 | 🟢 All docs within 2 days of code |
| Accuracy  | 88/100 | 🟡 2 mismatches found |
| Coverage  | 97%    | 🟡 11 undocumented symbols (bus package + 2 core) |
| Quality   | 96/100 | 🟢 Minor structural improvements |

**Overall health**: 95/100

## Critical Findings (fix immediately)

### 1. GET /bots route missing from agent.md route table
- **File**: website/docs/reference/api/agent.md
- **Code**: packages/agent/src/server.ts:64-70
- **Issue**: Route exists and is used by `bot ls --mesh` but not in the HTTP routes documentation table
- **Fix**: Add `GET /bots` to agent.md route table

### 2. Bot spawn workspace default mismatch
- **File**: website/docs/reference/cli/bot.md:23
- **Code**: packages/cli/src/commands/bot-spawn.ts:148-151
- **Issue**: Doc says `[path]` defaults to "home directory" but code defaults to `~/.mecha/<name>/workspace/`
- **Fix**: Update description to "defaults to `~/.mecha/<name>/workspace/`"

## Medium Findings (fix soon)

### 3. @mecha/bus has no API reference page
- **Issue**: 9 public exports (createBroker, createQueue, createTopic, createReplicator, etc.) with zero API documentation
- **Fix**: Create website/docs/reference/api/bus.md

### 4. validateAddDirs + MAX_ADD_DIRS not in core.md
- **Issue**: Newly added symbols exported from @mecha/core but not documented
- **Fix**: Add to core.md validation section

### 5. task-protocol.md missing [[toc]]
- **Fix**: Add `[[toc]]` after intro paragraph

## Low Findings (nice to have)

- connect.md: 996 lines, could use H2 groupings for 52 H3 subsections
- process.md: buildBotEnv description is dense, could be bullet points
- bot.md: spawn options table could group by category

## Fixing Plan

1. Fix bot.md workspace default description (1 line)
2. Add GET /bots to agent.md route table (5 lines)
3. Add [[toc]] to task-protocol.md (1 line)
4. Add validateAddDirs + MAX_ADD_DIRS to core.md (15 lines)
5. Create bus.md API reference (new file, ~200 lines)
