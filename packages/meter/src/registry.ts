import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { BotRegistryEntry } from "./types.js";

/** Scan mechaDir subdirectories for config.json to build the bot registry */
export function scanBotRegistry(mechaDir: string): Map<string, BotRegistryEntry> {
  const registry = new Map<string, BotRegistryEntry>();

  let entries: string[];
  try {
    entries = readdirSync(mechaDir);
  } catch {
    return registry;
  }

  for (const name of entries) {
    const botDir = join(mechaDir, name);
    try {
      if (!statSync(botDir).isDirectory()) continue;
      const configPath = join(botDir, "config.json");
      const raw = readFileSync(configPath, "utf-8");
      const config = JSON.parse(raw) as Record<string, unknown>;
      // Only include dirs with a valid config (has workspace field)
      if (typeof config.workspace === "string") {
        registry.set(name, {
          name,
          authProfile: typeof config.auth === "string" ? config.auth : "unknown",
          workspace: config.workspace,
          tags: Array.isArray(config.tags) ? config.tags.filter((t): t is string => typeof t === "string") : [],
        });
      }
    } catch {
      // Skip dirs without valid config.json
    }
  }

  return registry;
}

/** Look up a bot in the registry, returning defaults for unknown bots */
export function lookupBot(
  registry: Map<string, BotRegistryEntry>,
  name: string,
): BotRegistryEntry {
  return registry.get(name) ?? {
    name,
    authProfile: "unknown",
    workspace: "unknown",
    tags: [],
  };
}
