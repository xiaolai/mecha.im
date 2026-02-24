// @mecha/service — business logic layer
// Phase 1: lifecycle, read-only sessions, init, doctor, tools, auth (chat via Agent SDK)

export { runtimeFetch } from "./helpers.js";
export type { RuntimeFetchOpts, RuntimeFetchResult } from "./helpers.js";
export {
  casaSpawn,
  casaLs,
  casaStatus,
  casaKill,
  casaStop,
  casaLogs,
} from "./lifecycle.js";
export { casaChat } from "./chat.js";
export type { ChatOpts, ChatEvent } from "./chat.js";
export {
  casaSessionList,
  casaSessionGet,
} from "./sessions.js";
export { mechaInit } from "./init.js";
export type { InitResult } from "./init.js";
export { mechaDoctor } from "./doctor.js";
export type { DoctorCheck, DoctorResult } from "./doctor.js";
export { mechaToolInstall, mechaToolLs } from "./tools.js";
export type { ToolInfo, ToolInstallOpts } from "./tools.js";
export {
  mechaAuthAdd,
  mechaAuthLs,
  mechaAuthDefault,
  mechaAuthRm,
  mechaAuthTag,
  mechaAuthSwitch,
  mechaAuthTest,
  mechaAuthRenew,
  mechaAuthGet,
  mechaAuthGetDefault,
} from "./auth.js";
export type { AuthProfile } from "./auth.js";
