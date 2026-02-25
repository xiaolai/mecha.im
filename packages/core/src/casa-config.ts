import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { safeReadJson } from "./safe-read.js";

/** Sandbox enforcement mode */
export type SandboxMode = "auto" | "off" | "require";

/** Current config schema version — bump when shape changes */
export const CASA_CONFIG_VERSION = 1;

/** CASA configuration persisted in config.json */
export interface CasaConfig {
  /** Schema version for forward-compatible reads */
  configVersion?: number;
  port: number;
  token: string;
  workspace: string;
  model?: string;
  permissionMode?: string;
  auth?: string;
  tags?: string[];
  expose?: string[];
  sandboxMode?: SandboxMode;
  allowNetwork?: boolean;
}

function isCasaConfig(v: unknown): v is CasaConfig {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.port === "number" && typeof o.token === "string" && typeof o.workspace === "string";
}

/** Read a CASA's config.json. Returns undefined if missing or malformed. */
export function readCasaConfig(casaDir: string): CasaConfig | undefined {
  const configPath = join(casaDir, "config.json");
  const result = safeReadJson<unknown>(configPath, "casa config");
  if (!result.ok) {
    if (result.reason !== "missing") {
      console.error(`[mecha] ${result.detail}`);
    }
    return undefined;
  }
  if (!isCasaConfig(result.data)) return undefined;
  const parsed = result.data;
  // Normalize tags and expose to string[] | undefined
  if (parsed.tags !== undefined && !Array.isArray(parsed.tags)) {
    parsed.tags = undefined;
  }
  if (parsed.expose !== undefined && !Array.isArray(parsed.expose)) {
    parsed.expose = undefined;
  }
  // Validate sandboxMode against known values
  if (parsed.sandboxMode !== undefined && !["auto", "off", "require"].includes(parsed.sandboxMode as string)) {
    parsed.sandboxMode = undefined;
  }
  return parsed;
}

/** Update fields in a CASA's config.json (read-modify-write, atomic). */
export function updateCasaConfig(
  casaDir: string,
  updates: Partial<CasaConfig>,
): void {
  const configPath = join(casaDir, "config.json");
  const existing = readCasaConfig(casaDir) ?? ({} as Partial<CasaConfig>);
  const merged = { ...existing, ...updates, configVersion: CASA_CONFIG_VERSION };
  const tmp = configPath + `.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(tmp, JSON.stringify(merged, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, configPath);
}
