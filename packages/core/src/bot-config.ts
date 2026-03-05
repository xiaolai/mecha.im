import { writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { safeReadJson } from "./safe-read.js";
import { createLogger } from "./logger.js";

const log = createLogger("mecha:core");

/** Sandbox enforcement mode */
export type SandboxMode = "auto" | "off" | "require";

/** Current config schema version — bump when shape changes */
export const BOT_CONFIG_VERSION = 1;

/** bot configuration persisted in config.json */
export interface BotConfig {
  /** Schema version for forward-compatible reads */
  configVersion?: number;
  port: number;
  token: string;
  workspace: string;
  /** Custom HOME directory. When undefined, defaults to botDir (~/.mecha/<name>/) */
  home?: string;
  model?: string;
  permissionMode?: string;
  auth?: string;
  tags?: string[];
  expose?: string[];
  sandboxMode?: SandboxMode;
  allowNetwork?: boolean;
}

const BotConfigSchema: z.ZodType<BotConfig> = z.object({
  configVersion: z.number().optional(),
  port: z.number(),
  token: z.string(),
  workspace: z.string(),
  home: z.string().optional(),
  model: z.string().optional(),
  permissionMode: z.string().optional(),
  auth: z.string().optional(),
  tags: z.array(z.string()).optional(),
  expose: z.array(z.string()).optional(),
  sandboxMode: z.enum(["auto", "off", "require"]).optional(),
  allowNetwork: z.boolean().optional(),
});

/** Read a bot's config.json. Returns undefined if missing or malformed. */
export function readBotConfig(botDir: string): BotConfig | undefined {
  const configPath = join(botDir, "config.json");
  const result = safeReadJson(configPath, "bot config", BotConfigSchema);
  if (!result.ok) {
    if (result.reason !== "missing") {
      log.error("Bot config error", { detail: result.detail });
    }
    return undefined;
  }
  return result.data;
}

/** Update fields in a bot's config.json (read-modify-write, atomic).
 *  When the existing config is corrupt/missing, uses `fallback` as base if provided. */
export function updateBotConfig(
  botDir: string,
  updates: Partial<BotConfig>,
  fallback?: BotConfig,
): void {
  const configPath = join(botDir, "config.json");
  const existing = readBotConfig(botDir);
  const base = existing ?? fallback;
  if (!base) {
    throw new Error(`Cannot update bot config: no valid config.json found in ${botDir}`);
  }
  const merged = { ...base, ...updates, configVersion: BOT_CONFIG_VERSION };
  // Validate merged result against schema before persisting
  BotConfigSchema.parse(merged);
  const tmp = configPath + `.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(tmp, JSON.stringify(merged, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, configPath);
}
