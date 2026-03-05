import { join } from "node:path";
import { type BotName, type BotConfig, BotNotFoundError, isValidName, readBotConfig, updateBotConfig, matchesDiscoveryFilter } from "@mecha/core";
import type { ProcessManager, ProcessInfo } from "@mecha/process";

export interface FindResult extends ProcessInfo {
  tags: string[];
}

export function botStatus(pm: ProcessManager, name: BotName): ProcessInfo {
  const info = pm.get(name);
  if (!info) throw new BotNotFoundError(name);
  return info;
}

export function botFind(
  mechaDir: string,
  pm: ProcessManager,
  opts: { tags?: string[] },
): FindResult[] {
  const bots = pm.list();
  const results: FindResult[] = [];
  for (const info of bots) {
    if (!isValidName(info.name)) continue;
    const config = readBotConfig(join(mechaDir, info.name));
    const raw = config?.tags;
    const tags = Array.isArray(raw) ? raw.filter((t): t is string => typeof t === "string") : [];
    if (!matchesDiscoveryFilter({ tags, expose: [] }, opts)) continue;
    results.push({ ...info, tags });
  }
  return results;
}

export interface BotConfigUpdates {
  auth?: string | null;
  model?: string;
  tags?: string[];
  expose?: string[];
  sandboxMode?: "auto" | "off" | "require";
  permissionMode?: string;
  home?: string;
  workspace?: string;
}

export function botConfigure(
  mechaDir: string,
  pm: ProcessManager,
  name: BotName,
  updates: BotConfigUpdates,
): void {
  const info = pm.get(name);
  if (!info) throw new BotNotFoundError(name);
  // Fallback base for corrupt/missing config — reconstruct from ProcessInfo
  /* v8 ignore start -- null coalescing fallbacks for optional ProcessInfo fields */
  const fallback = {
    port: info.port ?? 0,
    token: "",
    workspace: info.workspacePath ?? "",
  };
  /* v8 ignore stop */
  // When auth is explicitly null, clear auth from config.
  // When auth is a string, set it. When undefined, leave unchanged.
  const { auth, ...rest } = updates;
  const botDir = join(mechaDir, name);
  const configUpdates: Partial<BotConfig> = { ...rest, ...(auth != null ? { auth } : {}) };
  updateBotConfig(botDir, configUpdates, fallback);
  if (auth === null) {
    // Remove auth field: read back merged config, delete key, write again
    const merged = readBotConfig(botDir);
    /* v8 ignore start -- merged always exists after updateBotConfig above */
    if (merged && "auth" in merged) {
      delete (merged as unknown as Record<string, unknown>).auth;
      updateBotConfig(botDir, merged);
    }
    /* v8 ignore stop */
  }
}
