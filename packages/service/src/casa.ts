import { join } from "node:path";
import { type CasaName, CasaNotFoundError, readCasaConfig, updateCasaConfig } from "@mecha/core";
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
    const config = readCasaConfig(join(mechaDir, info.name));
    const tags = config?.tags ?? [];
    if (opts.tags && opts.tags.length > 0) {
      const has = new Set(tags);
      if (!opts.tags.every((t) => has.has(t))) continue;
    }
    results.push({ ...info, tags });
  }
  return results;
}

export function casaConfigure(
  mechaDir: string,
  pm: ProcessManager,
  name: CasaName,
  updates: { tags?: string[] },
): void {
  const info = pm.get(name);
  if (!info) throw new CasaNotFoundError(name);
  updateCasaConfig(join(mechaDir, name), updates);
}
