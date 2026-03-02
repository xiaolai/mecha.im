import { join } from "node:path";
import { type CasaName, type CasaConfig, CasaNotFoundError, isValidName, readCasaConfig, updateCasaConfig, matchesDiscoveryFilter } from "@mecha/core";
import type { ProcessManager, ProcessInfo } from "@mecha/process";

export interface FindResult extends ProcessInfo {
  tags: string[];
}

export function casaStatus(pm: ProcessManager, name: CasaName): ProcessInfo {
  const info = pm.get(name);
  if (!info) throw new CasaNotFoundError(name);
  return info;
}

export function casaFind(
  mechaDir: string,
  pm: ProcessManager,
  opts: { tags?: string[] },
): FindResult[] {
  const casas = pm.list();
  const results: FindResult[] = [];
  for (const info of casas) {
    if (!isValidName(info.name)) continue;
    const config = readCasaConfig(join(mechaDir, info.name));
    const raw = config?.tags;
    const tags = Array.isArray(raw) ? raw.filter((t): t is string => typeof t === "string") : [];
    if (!matchesDiscoveryFilter({ tags, expose: [] }, opts)) continue;
    results.push({ ...info, tags });
  }
  return results;
}

export interface CasaConfigUpdates {
  auth?: string | null;
  model?: string;
  tags?: string[];
  expose?: string[];
  sandboxMode?: "auto" | "off" | "require";
  permissionMode?: string;
}

export function casaConfigure(
  mechaDir: string,
  pm: ProcessManager,
  name: CasaName,
  updates: CasaConfigUpdates,
): void {
  const info = pm.get(name);
  if (!info) throw new CasaNotFoundError(name);
  // Fallback base for corrupt/missing config — reconstruct from ProcessInfo
  /* v8 ignore start -- null coalescing fallbacks for optional ProcessInfo fields */
  const fallback = {
    port: info.port ?? 0,
    token: "",
    workspace: info.workspacePath ?? "",
  };
  /* v8 ignore stop */
  // Convert null auth to undefined to clear the field; strip null from type
  const { auth, ...rest } = updates;
  const configUpdates: Partial<CasaConfig> = { ...rest, ...(auth !== null && auth !== undefined ? { auth } : {}) };
  updateCasaConfig(join(mechaDir, name), configUpdates, fallback);
}
