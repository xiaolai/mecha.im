import { writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { safeReadJson } from "./safe-read.js";

const MechaSettingsSchema = z.object({
  forceHttps: z.boolean().optional(),
}).passthrough();

export type MechaSettings = z.infer<typeof MechaSettingsSchema>;

const SETTINGS_FILE = "settings.json";

export function readMechaSettings(mechaDir: string): MechaSettings {
  const result = safeReadJson(join(mechaDir, SETTINGS_FILE), "mecha settings", MechaSettingsSchema);
  if (!result.ok) return {};
  return result.data;
}

export function writeMechaSettings(mechaDir: string, settings: MechaSettings): void {
  MechaSettingsSchema.parse(settings);
  const filePath = join(mechaDir, SETTINGS_FILE);
  const tmp = filePath + `.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(tmp, JSON.stringify(settings, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, filePath);
}
