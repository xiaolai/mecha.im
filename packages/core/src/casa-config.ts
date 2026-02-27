import { writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { z } from "zod";
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

const CasaConfigSchema: z.ZodType<CasaConfig> = z.object({
  configVersion: z.number().optional(),
  port: z.number(),
  token: z.string(),
  workspace: z.string(),
  model: z.string().optional(),
  permissionMode: z.string().optional(),
  auth: z.string().optional(),
  tags: z.array(z.string()).optional(),
  expose: z.array(z.string()).optional(),
  sandboxMode: z.enum(["auto", "off", "require"]).optional(),
  allowNetwork: z.boolean().optional(),
});

/** Read a CASA's config.json. Returns undefined if missing or malformed. */
export function readCasaConfig(casaDir: string): CasaConfig | undefined {
  const configPath = join(casaDir, "config.json");
  const result = safeReadJson(configPath, "casa config", CasaConfigSchema);
  if (!result.ok) {
    if (result.reason !== "missing") {
      console.error(`[mecha] ${result.detail}`);
    }
    return undefined;
  }
  return result.data;
}

/** Update fields in a CASA's config.json (read-modify-write, atomic).
 *  When the existing config is corrupt/missing, uses `fallback` as base if provided. */
export function updateCasaConfig(
  casaDir: string,
  updates: Partial<CasaConfig>,
  fallback?: CasaConfig,
): void {
  const configPath = join(casaDir, "config.json");
  const existing = readCasaConfig(casaDir);
  const base = existing ?? fallback;
  if (!base) {
    throw new Error(`Cannot update CASA config: no valid config.json found in ${casaDir}`);
  }
  const merged = { ...base, ...updates, configVersion: CASA_CONFIG_VERSION };
  // Validate merged result against schema before persisting
  CasaConfigSchema.parse(merged);
  const tmp = configPath + `.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(tmp, JSON.stringify(merged, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, configPath);
}
