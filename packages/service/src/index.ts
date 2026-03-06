// @mecha/service — business logic layer

export { resolveBotEndpoint, runtimeFetch, assertOk } from "./helpers.js";
export type { RuntimeFetchOpts, RuntimeFetchResult } from "./helpers.js";
export { botStatus, botFind, botConfigure } from "./bot.js";
export type { FindResult, BotConfigUpdates } from "./bot.js";
export { botChat } from "./chat.js";
export type { ChatOpts, ChatEvent } from "./chat.js";
export {
  botSessionList,
  botSessionGet,
  botSessionDelete,
} from "./sessions.js";
export { mechaInit } from "./init.js";
export type { InitResult } from "./init.js";
export { mechaDoctor } from "./doctor.js";
export type { DoctorCheck, DoctorResult } from "./doctor.js";
export { mechaToolInstall, mechaToolLs, mechaToolRemove } from "./tools.js";
export type { ToolInfo, ToolInstallOpts } from "./tools.js";
export {
  mechaAuthAdd,
  mechaAuthAddFull,
  mechaAuthLs,
  mechaAuthDefault,
  mechaAuthRm,
  mechaAuthTag,
  mechaAuthSwitch,
  mechaAuthTest,
  mechaAuthRenew,
  mechaAuthGet,
  mechaAuthGetDefault,
  mechaAuthSwitchBot,
} from "./auth.js";
export { mechaAuthProbe } from "./auth-probe.js";
export type { AuthProfile, AuthAddOpts } from "./auth.js";
export { buildHierarchy, flattenHierarchy } from "./hierarchy.js";
export type { HierarchyNode } from "./hierarchy.js";
export { createBotRouter } from "./router.js";
export type { BotRouter, CreateRouterOpts } from "./router.js";
export { nodeInit, readNodeName } from "./node-init.js";
export type { NodeInitResult } from "./node-init.js";
export { agentFetch } from "./agent-fetch.js";
export type { AgentFetchOpts, SecureChannelLike } from "./agent-fetch.js";
export { createLocator } from "./locator.js";
export type { MechaLocator, LocateResult, CreateLocatorOpts } from "./locator.js";
export { checkBotBusy } from "./task-check.js";
export type { TaskCheckResult } from "./task-check.js";
export { batchBotAction } from "./bot-batch.js";
export type { BatchActionOpts, BatchItemResult, BatchResult } from "./bot-batch.js";
export { enrichBotInfo, buildEnrichContext } from "./bot-enrich.js";
export type { EnrichedBotInfo, EnrichContext } from "./bot-enrich.js";
export { getCachedSnapshot, invalidateSnapshotCache } from "./snapshot-cache.js";
export {
  botScheduleAdd,
  botScheduleRemove,
  botScheduleList,
  botSchedulePause,
  botScheduleResume,
  botScheduleRun,
  botScheduleHistory,
} from "./schedule.js";
export { nodePing } from "./node-ping.js";
export type { PingResult } from "./node-ping.js";
export { resolveClaudeRuntime, invalidateClaudeRuntimeCache } from "./claude-runtime.js";
export type { ClaudeRuntimeInfo, ResolvedFrom } from "./claude-runtime.js";
