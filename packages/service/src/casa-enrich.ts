import { join } from "node:path";
import { readCasaConfig, readAuthProfiles } from "@mecha/core";
import type { CasaConfig, AuthProfileStore } from "@mecha/core";
import type { ProcessInfo } from "@mecha/process";
import type { HotSnapshot } from "@mecha/meter";

export interface EnrichedCasaInfo {
  name: string;
  state: "running" | "stopped" | "error";
  pid?: number;
  port?: number;
  workspacePath: string;
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

export interface EnrichContext {
  configs: Map<string, CasaConfig>;
  snapshot: HotSnapshot | null;
  authStore: AuthProfileStore;
}

/** Build context once per request — all I/O happens here, enrichCasaInfo is pure. */
export function buildEnrichContext(
  mechaDir: string,
  snapshot: HotSnapshot | null,
  casaNames: string[],
): EnrichContext {
  const configs = new Map<string, CasaConfig>();
  for (const name of casaNames) {
    const cfg = readCasaConfig(join(mechaDir, name));
    if (cfg) configs.set(name, cfg);
  }
  return { configs, snapshot, authStore: readAuthProfiles(mechaDir) };
}

/** Pure mapper — no I/O. Merges ProcessInfo + config + auth + meter data. */
export function enrichCasaInfo(
  info: ProcessInfo,
  ctx: EnrichContext,
): EnrichedCasaInfo {
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

  const casaCost = ctx.snapshot?.byCasa[info.name];

  return {
    ...base,
    ...(config?.model != null && { model: config.model }),
    ...(config?.sandboxMode != null && { sandboxMode: config.sandboxMode }),
    ...(config?.permissionMode != null && { permissionMode: config.permissionMode }),
    ...(config?.tags != null && { tags: config.tags }),
    ...(config?.auth != null && { auth: config.auth }),
    ...(authType != null && { authType }),
    ...(casaCost?.today.costUsd != null && { costToday: casaCost.today.costUsd }),
  };
}
