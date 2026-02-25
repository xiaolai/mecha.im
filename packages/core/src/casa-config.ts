import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

/** CASA configuration persisted in config.json */
export interface CasaConfig {
  port: number;
  token: string;
  workspace: string;
  model?: string;
  permissionMode?: string;
  auth?: string;
  tags?: string[];
}

function isCasaConfig(v: unknown): v is CasaConfig {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.port === "number" && typeof o.token === "string" && typeof o.workspace === "string";
}

/** Read a CASA's config.json. Returns undefined if missing or malformed. */
export function readCasaConfig(casaDir: string): CasaConfig | undefined {
  const configPath = join(casaDir, "config.json");
  if (!existsSync(configPath)) return undefined;
  try {
    const parsed: unknown = JSON.parse(readFileSync(configPath, "utf-8"));
    if (!isCasaConfig(parsed)) return undefined;
    // Normalize tags to string[] | undefined
    if (parsed.tags !== undefined && !Array.isArray(parsed.tags)) {
      parsed.tags = undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

/** Update fields in a CASA's config.json (read-modify-write, atomic). */
export function updateCasaConfig(
  casaDir: string,
  updates: Partial<CasaConfig>,
): void {
  const configPath = join(casaDir, "config.json");
  const existing = readCasaConfig(casaDir) ?? ({} as Partial<CasaConfig>);
  const merged = { ...existing, ...updates };
  const tmp = configPath + `.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(tmp, JSON.stringify(merged, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, configPath);
}
