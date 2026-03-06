import { join } from "node:path";
import { readBotConfig, readAuthProfiles } from "@mecha/core";
import type { BotConfig, AuthProfileStore } from "@mecha/core";
import type { ProcessInfo } from "@mecha/process";
import type { HotSnapshot } from "@mecha/meter";

/** Bot info enriched with config, auth type, and meter cost data. */
export interface EnrichedBotInfo {
  name: string;
  state: "running" | "stopped" | "error";
  pid?: number;
  port?: number;
  workspacePath: string;
  homeDir?: string;
  startedAt?: string;
  stoppedAt?: string;
  exitCode?: number;
  model?: string;
  sandboxMode?: string;
  permissionMode?: string;
  tags?: string[];
  auth?: string;
  authType?: "oauth" | "api-key";
  costToday?: number;
}

/** Pre-loaded context for enriching bot info (configs, meter snapshot, auth store). */
export interface EnrichContext {
  configs: Map<string, BotConfig>;
  snapshot: HotSnapshot | null;
  authStore: AuthProfileStore;
}

/** Build context once per request — all I/O happens here, enrichBotInfo is pure. */
export function buildEnrichContext(
  mechaDir: string,
  snapshot: HotSnapshot | null,
  botNames: string[],
): EnrichContext {
  const configs = new Map<string, BotConfig>();
  for (const name of botNames) {
    const cfg = readBotConfig(join(mechaDir, name));
    if (cfg) configs.set(name, cfg);
  }
  return { configs, snapshot, authStore: readAuthProfiles(mechaDir) };
}

/** Pure mapper — no I/O. Merges ProcessInfo + config + auth + meter data. */
export function enrichBotInfo(
  info: ProcessInfo,
  ctx: EnrichContext,
): EnrichedBotInfo {
  const { token: _token, ...base } = info;

  const config = ctx.configs.get(info.name);

  let authType: "oauth" | "api-key" | undefined;
  if (config?.auth) {
    // $env: sentinel profiles have known types based on their name
    const envTypeMap: Record<string, "oauth" | "api-key"> = {
      "$env:api-key": "api-key",
      "$env:oauth": "oauth",
    };
    if (config.auth in envTypeMap) {
      authType = envTypeMap[config.auth];
    } else if (Object.hasOwn(ctx.authStore.profiles, config.auth)) {
      /* v8 ignore start -- optional chaining guard for malformed profile store */
      authType = ctx.authStore.profiles[config.auth]?.type;
      /* v8 ignore stop */
    }
  }

  const casaCost = ctx.snapshot?.byBot[info.name];

  return {
    ...base,
    ...(config?.home != null && { homeDir: config.home }),
    ...(config?.model != null && { model: config.model }),
    ...(config?.sandboxMode != null && { sandboxMode: config.sandboxMode }),
    ...(config?.permissionMode != null && { permissionMode: config.permissionMode }),
    ...(config?.tags != null && { tags: config.tags }),
    ...(config?.auth != null && { auth: config.auth }),
    ...(authType != null && { authType }),
    ...(casaCost?.today.costUsd != null && { costToday: casaCost.today.costUsd }),
  };
}
