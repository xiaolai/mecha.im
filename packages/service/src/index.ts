// @mecha/service — business logic layer

export { resolveCasaEndpoint, runtimeFetch, assertOk } from "./helpers.js";
export type { RuntimeFetchOpts, RuntimeFetchResult } from "./helpers.js";
export { casaStatus, casaFind, casaConfigure } from "./casa.js";
export type { FindResult, CasaConfigUpdates } from "./casa.js";
export { casaChat } from "./chat.js";
export type { ChatOpts, ChatEvent } from "./chat.js";
export {
  casaSessionList,
  casaSessionGet,
  casaSessionDelete,
} from "./sessions.js";
export { mechaInit } from "./init.js";
export type { InitResult } from "./init.js";
export { mechaDoctor } from "./doctor.js";
export type { DoctorCheck, DoctorResult } from "./doctor.js";
export { mechaToolInstall, mechaToolLs } from "./tools.js";
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
  mechaAuthSwitchCasa,
  mechaAuthProbe,
} from "./auth.js";
export type { AuthProfile, AuthAddOpts } from "./auth.js";
export { buildHierarchy, flattenHierarchy } from "./hierarchy.js";
export type { HierarchyNode } from "./hierarchy.js";
export { createCasaRouter } from "./router.js";
export type { CasaRouter, CreateRouterOpts } from "./router.js";
export { nodeInit, readNodeName } from "./node-init.js";
export type { NodeInitResult } from "./node-init.js";
export { agentFetch } from "./agent-fetch.js";
export type { AgentFetchOpts, SecureChannelLike } from "./agent-fetch.js";
export { createLocator } from "./locator.js";
export type { MechaLocator, LocateResult, CreateLocatorOpts } from "./locator.js";
export { checkCasaBusy } from "./task-check.js";
export type { TaskCheckResult } from "./task-check.js";
export { batchCasaAction } from "./casa-batch.js";
export type { BatchActionOpts, BatchItemResult, BatchResult } from "./casa-batch.js";
export { enrichCasaInfo, buildEnrichContext } from "./casa-enrich.js";
export type { EnrichedCasaInfo, EnrichContext } from "./casa-enrich.js";
export { getCachedSnapshot, invalidateSnapshotCache } from "./snapshot-cache.js";
export {
  casaScheduleAdd,
  casaScheduleRemove,
  casaScheduleList,
  casaSchedulePause,
  casaScheduleResume,
  casaScheduleRun,
  casaScheduleHistory,
} from "./schedule.js";
