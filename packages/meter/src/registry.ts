import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { CasaRegistryEntry } from "./types.js";

/** Scan mechaDir subdirectories for config.json to build the CASA registry */
export function scanCasaRegistry(mechaDir: string): Map<string, CasaRegistryEntry> {
  const registry = new Map<string, CasaRegistryEntry>();

  let entries: string[];
  try {
    entries = readdirSync(mechaDir);
  } catch {
    return registry;
  }

  for (const name of entries) {
    const casaDir = join(mechaDir, name);
    try {
      if (!statSync(casaDir).isDirectory()) continue;
      const configPath = join(casaDir, "config.json");
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

/** Look up a CASA in the registry, returning defaults for unknown CASAs */
export function lookupCasa(
  registry: Map<string, CasaRegistryEntry>,
  name: string,
): CasaRegistryEntry {
  return registry.get(name) ?? {
    name,
    authProfile: "unknown",
    workspace: "unknown",
    tags: [],
  };
}
