# Documentation Audit Report

**Project**: mecha.im
**Date**: 2026-03-24
**Language**: TypeScript
**Framework**: VitePress

## Executive Summary

| Dimension | Score | Status |
|-----------|-------|--------|
| Freshness | 100/100 | 🟢 |
| Accuracy  | 91/100  | 🟡 |
| Coverage  | 99%     | 🟢 |
| Quality   | 88/100  | 🟢 |

**Overall health: 94/100**

---

## Critical Findings (fix immediately)

### [HIGH] `CreateServerOpts` missing 5 fields in runtime docs

- **Source**: `packages/runtime/src/server.ts:17-37`
- **Doc**: `website/docs/reference/api/runtime.md:106-118`
- **Code says**: `CreateServerOpts` includes `systemPrompt?`, `appendSystemPrompt?`, `mcpServers?`, `agentPort?`, `agentApiKey?`
- **Doc says**: Only documents `botName`, `port`, `authToken`, `projectsDir`, `workspacePath`, `mechaDir`, `botDir`, `scheduleChatFn`
- **Fix**: Add the five missing optional fields to the `CreateServerOpts` table.

### [HIGH] `@mecha/server` docs list phantom barrel exports

- **Source**: `packages/server/src/index.ts`
- **Doc**: `website/docs/reference/api/server.md:37-40`
- **Code says**: Barrel does NOT re-export `registerSignaling`, `registerInviteRoutes`, `registerRelay`, `registerGossip`
- **Doc says**: Lists them as barrel exports
- **Fix**: Remove from barrel exports table or add the re-exports to `index.ts`.

### [HIGH] `SdkChatOpts` missing 5 fields in runtime docs

- **Source**: `packages/runtime/src/sdk-chat.ts:51-68`
- **Doc**: `website/docs/reference/api/runtime.md:223-236`
- **Code says**: Includes `systemPrompt?`, `appendSystemPrompt?`, `activityEmitter?`, `botName?`, `mcpServers?`
- **Doc says**: Only documents `workspacePath`, `settingSources`, `env`
- **Fix**: Add the five missing optional fields.

---

## Medium Findings (fix soon)

### [MEDIUM] `BotFilesystemOpts` missing 18 spawn setting fields

- **Source**: `packages/process/src/sandbox-setup.ts:16-58`
- **Doc**: `website/docs/reference/api/process.md:188-206`
- **Code says**: Includes `systemPrompt`, `appendSystemPrompt`, `effort`, `maxBudgetUsd`, `allowedTools`, `disallowedTools`, `tools`, `agent`, `agents`, `sessionPersistence`, `budgetLimit`, `mcpServers`, `mcpConfigFiles`, `strictMcpConfig`, `disableSlashCommands`, `dangerouslySkipPermissions`, `allowDangerouslySkipPermissions`, `fallbackModel`, `addDirs`
- **Doc says**: Only lists `botDir`, `workspacePath`, `port`, `token`, `name`, `mechaDir`, `model`, `permissionMode`, `auth`, `tags`, `expose`, `userEnv`, `meterOff`, `home`
- **Fix**: Add missing fields to `BotFilesystemOpts` table or create a cross-referenced "spawn settings" subsection.

### [MEDIUM] Activity event routes undocumented in runtime API

- **Source**: `packages/runtime/src/server.ts:101`
- **Doc**: `website/docs/reference/api/runtime.md:56-79`
- **Details**: `registerActivityEventsRoutes` is called in `createServer` but no activity event endpoints appear in the route table.
- **Fix**: Document the activity event routes.

### [MEDIUM] `McpRouteOpts` interface mismatch in runtime docs

- **Source**: `packages/runtime/src/server.ts:108-114`
- **Doc**: `website/docs/reference/api/runtime.md:183-191`
- **Code says**: Passes `{ workspacePath, mechaDir, botName, agentPort, agentApiKey }`
- **Doc says**: `McpRouteOpts` has `workspacePath`, `mechaDir?`, `botName?`, `router: MeshRouter?`
- **Fix**: Update docs to match actual interface fields.

### [MEDIUM] `mecha bus queue push` CLI command undocumented

- **Source**: `packages/cli/src/commands/bus-queue-push.ts`
- **Doc**: `website/docs/reference/cli/orchestration.md`
- **Details**: Registered under `bus queue` subcommand group but absent from CLI reference.
- **Fix**: Add to orchestration.md Bus section.

### [MEDIUM] Orchestration CLI reference incomplete

- **File**: `website/docs/reference/cli/orchestration.md`
- **Issue**: Many subsections lack detailed parameter tables or examples. Some `mecha team` commands documented in features but not CLI reference.
- **Fix**: Expand with complete parameter tables and examples.

### [MEDIUM] Missing `[[toc]]` in 9 doc files

- **Files**: `index.md`, `guide/index.md`, `guide/dashboard.md`, `reference/errors.md`, `reference/environment.md`, `reference/components.md`, `license.md`, `guide/cost-evaluation.md`, `guide/troubleshooting.md`
- **Fix**: Add `[[toc]]` after H1 heading and intro paragraph.

---

## Low Findings (nice to have)

| Finding | File | Fix |
|---------|------|-----|
| Server doc includes agent-package symbols (`AuthOpts`, `getSource`, `startMeterDaemon`, `stopMeterDaemon`) | `reference/api/server.md` | Move to agent docs or add cross-package note |
| `stopMeterDaemon` documented but not exported from barrel | `reference/api/server.md` | Add barrel export or remove from docs |
| `RelayPair.timer` type: doc says `Timeout`, code says `ReturnType<typeof setTimeout>` | `reference/api/server.md:115` | Update to match code |
| `mcpServers` missing from service spawn settings | `reference/api/service.md:141-146` | Add to MCP spawn settings table |
| `disallowedTools`/`tools` mutual exclusion rule missing | `reference/api/service.md:163-167` | Add validation rule |
| `ReplicatorFetchFn` type undocumented | `reference/api/bus.md` | Add to Replication section |
| `createServer` async/Promise return type not shown | `reference/api/server.md:42-56` | Update function signature heading |
| `TaskRouteOpts` interface undocumented | `reference/api/runtime.md` | Add interface table |
| Inconsistent code block language tags | `reference/api/meter.md`, `reference/api/connect.md` | Specify `ts`/`bash`/`json` tags |
| Skipped heading hierarchy (H2 to H4) | `features/observability.md` | Normalize to H2 then H3 then H4 |
| Long paragraph (>250 words) | `features/gateway.md` | Break into subsections |
| Missing examples for complex functions | `reference/api/meter.md` | Add usage snippets |

---

## Fixing Plan

Priority-ordered actions:

1. **Runtime API docs** — Add missing fields to `CreateServerOpts`, `SdkChatOpts`, and `McpRouteOpts` tables; document activity event routes (`website/docs/reference/api/runtime.md`)
2. **Server API docs** — Remove phantom barrel exports (`registerSignaling`, `registerInviteRoutes`, `registerRelay`, `registerGossip`); relocate agent-package symbols (`website/docs/reference/api/server.md`)
3. **Process API docs** — Add 18 missing spawn setting fields to `BotFilesystemOpts` (`website/docs/reference/api/process.md`)
4. **CLI orchestration docs** — Add `mecha bus queue push` command; expand parameter tables (`website/docs/reference/cli/orchestration.md`)
5. **Service API docs** — Add `mcpServers` to spawn settings; add `disallowedTools`/`tools` validation rule (`website/docs/reference/api/service.md`)
6. **Bus API docs** — Add `ReplicatorFetchFn` type (`website/docs/reference/api/bus.md`)
7. **Quality polish** — Add `[[toc]]` to 9 files; fix heading hierarchy in observability.md; add language tags to code blocks

---

## Full Agent Reports

<details>
<summary>Staleness Report</summary>

### Freshness Summary Table

| Source | Doc | Source Modified | Doc Modified | Gap | Status |
|--------|-----|-----------------|--------------|-----|--------|
| packages/core/src | reference/api/core.md | 2026-03-23 | 2026-03-23 | 0d | FRESH |
| packages/agent/src | reference/api/agent.md | 2026-03-23 | 2026-03-23 | 0d | FRESH |
| packages/runtime/src | reference/api/runtime.md | 2026-03-23 | 2026-03-22 | <1d | FRESH |
| packages/process/src | reference/api/process.md | 2026-03-23 | 2026-03-23 | 0d | FRESH |
| packages/service/src | reference/api/service.md | 2026-03-22 | 2026-03-22 | 0d | FRESH |
| packages/meter/src | reference/api/meter.md | 2026-03-21 | 2026-03-21 | 0d | FRESH |
| packages/connect/src | reference/api/connect.md | 2026-03-21 | 2026-03-23 | 0d | FRESH |
| packages/server/src | reference/api/server.md | 2026-03-21 | 2026-03-21 | 0d | FRESH |
| packages/mcp-server/src | reference/api/mcp-server.md | 2026-03-21 | 2026-03-21 | 0d | FRESH |
| packages/gateway/src | reference/api/gateway.md | 2026-03-21 | 2026-03-21 | 0d | FRESH |
| packages/sandbox/src | features/sandbox.md | 2026-03-23 | 2026-03-22 | <1d | FRESH |
| packages/bus/src | features/bus.md | 2026-03-21 | 2026-03-22 | 0d | FRESH |
| packages/workflow/src | features/workflow.md | 2026-03-21 | 2026-03-23 | 0d | FRESH |
| packages/observe/src | features/observability.md | 2026-03-21 | 2026-03-22 | 0d | FRESH |
| packages/teams/src | features/teams.md | 2026-03-21 | 2026-03-22 | 0d | FRESH |
| packages/cli/src/commands | reference/cli | 2026-03-23 | 2026-03-23 | 0d | FRESH |
| packages/spa/src | reference/components.md | 2026-03-21 | 2026-03-21 | 0d | FRESH |

**All 17 mappings are FRESH. No staleness detected.**

**Freshness Score: 100/100**

</details>

<details>
<summary>Accuracy Report</summary>

### Findings (14 total: 3 HIGH, 5 MEDIUM, 6 LOW)

**HIGH:**
1. `CreateServerOpts` missing 5 fields (`systemPrompt`, `appendSystemPrompt`, `mcpServers`, `agentPort`, `agentApiKey`)
2. `@mecha/server` barrel exports list 4 functions not actually re-exported
3. `SdkChatOpts` missing 5 fields (`systemPrompt`, `appendSystemPrompt`, `activityEmitter`, `botName`, `mcpServers`)

**MEDIUM:**
4. `BotFilesystemOpts` missing 18 spawn setting fields
5. `createServer` return type not shown as `Promise<FastifyInstance>`
6. Activity event routes undocumented in runtime
7. `McpRouteOpts` interface mismatch (code uses `agentPort`/`agentApiKey`, docs show `router: MeshRouter?`)
8. `@mecha/connect` missing barrel exports table

**LOW:**
9. Server doc includes agent-package symbols
10. `stopMeterDaemon` documented but not exported
11. `RelayPair.timer` type discrepancy
12. `mcpServers` missing from service spawn settings
13. `disallowedTools`/`tools` validation rule missing
14. `@mecha/process` `settingSources` correctly scoped (no action needed)

**Accuracy Score: 91/100**

</details>

<details>
<summary>Coverage Report</summary>

### Package API Coverage

| Package | Public Symbols | Documented | Coverage |
|---------|---------------|------------|----------|
| agent | ~12 | 12 | 100% |
| bus | 19 | 18 | 95% |
| connect | ~10 | 10 | 100% |
| core | ~25 | 25 | 100% |
| gateway | ~8 | 8 | 100% |
| mcp-server | ~6 | 6 | 100% |
| meter | ~14 | 14 | 100% |
| observe | ~12 | 12 | 100% |
| process | ~10 | 10 | 100% |
| runtime | ~8 | 8 | 100% |
| sandbox | ~8 | 8 | 100% |
| server | 21 | 21 | 100% |
| service | ~15 | 15 | 100% |
| teams | ~6 | 6 | 100% |
| workflow | ~10 | 10 | 100% |

### CLI Command Coverage

| Doc File | Commands | Documented | Coverage |
|----------|----------|------------|----------|
| bot.md | 17 | 17 | 100% |
| system.md | 35 | 35 | 100% |
| node.md | 10 | 10 | 100% |
| meter.md | 7 | 7 | 100% |
| schedule.md | 6 | 6 | 100% |
| orchestration.md | 44 | 43 | 98% |

### Undocumented Symbols (2)

1. **[MEDIUM]** `mecha bus queue push` — CLI command missing from orchestration.md
2. **[LOW]** `ReplicatorFetchFn` — type alias missing from bus.md

**Overall Coverage: 99%**

</details>

<details>
<summary>Quality Report</summary>

### Quality Matrix

| File | Structure | Completeness | Readability | Consistency | Score |
|------|-----------|-------------|-------------|-------------|-------|
| reference/api/index.md | ✅ | ✅ | ✅ | ✅ | 95 |
| reference/api/core.md | ✅ | ✅ | ✅ | ✅ | 94 |
| reference/api/agent.md | ✅ | ✅ | ✅ | ✅ | 93 |
| reference/api/runtime.md | ✅ | ✅ | ✅ | ✅ | 93 |
| reference/api/process.md | ✅ | ✅ | ✅ | ✅ | 92 |
| reference/api/service.md | ✅ | ✅ | ✅ | ✅ | 92 |
| reference/api/server.md | ✅ | ✅ | ✅ | ✅ | 91 |
| reference/api/bus.md | ✅ | ✅ | ✅ | ✅ | 91 |
| reference/api/connect.md | ✅ | ✅ | ✅ | ✅ | 90 |
| reference/api/mcp-server.md | ✅ | ✅ | ✅ | ✅ | 90 |
| reference/api/gateway.md | ✅ | ✅ | ⚠️ | ✅ | 89 |
| reference/api/meter.md | ✅ | ⚠️ | ✅ | ✅ | 88 |
| reference/cli/index.md | ✅ | ✅ | ✅ | ✅ | 93 |
| reference/cli/bot.md | ✅ | ✅ | ✅ | ✅ | 91 |
| reference/cli/node.md | ✅ | ✅ | ✅ | ✅ | 90 |
| reference/cli/system.md | ✅ | ✅ | ⚠️ | ✅ | 88 |
| reference/cli/orchestration.md | ⚠️ | ⚠️ | ✅ | ⚠️ | 82 |
| features/workflow.md | ✅ | ✅ | ✅ | ✅ | 92 |
| features/bus.md | ✅ | ✅ | ✅ | ✅ | 91 |
| features/task-protocol.md | ✅ | ✅ | ✅ | ✅ | 91 |
| features/sandbox.md | ✅ | ✅ | ✅ | ✅ | 90 |
| features/teams.md | ✅ | ✅ | ✅ | ✅ | 90 |
| features/multi-agent.md | ✅ | ✅ | ⚠️ | ✅ | 87 |
| features/observability.md | ⚠️ | ✅ | ⚠️ | ✅ | 84 |
| features/dashboard.md | ⚠️ | ⚠️ | ⚠️ | ✅ | 80 |

### Issues Summary

| Severity | Count |
|----------|-------|
| MEDIUM | 3 (missing TOCs, incomplete orchestration CLI, inconsistent code block tags) |
| LOW | 8+ (heading hierarchy, long paragraphs, missing examples) |

**Quality Score: 88/100**

</details>
