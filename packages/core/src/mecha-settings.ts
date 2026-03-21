import { writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { safeReadJson } from "./safe-read.js";

const MechaSettingsSchema = z.object({
  forceHttps: z.boolean().optional(),
}).passthrough();

/** Global mecha runtime settings persisted in settings.json. */
export type MechaSettings = z.infer<typeof MechaSettingsSchema>;

const SETTINGS_FILE = "settings.json";

/* v8 ignore start -- thin read/write wrappers over safeReadJson + atomic file write */
/** Read global mecha settings from mechaDir/settings.json. Returns empty object if missing. */
export function readMechaSettings(mechaDir: string): MechaSettings {
  const result = safeReadJson(join(mechaDir, SETTINGS_FILE), "mecha settings", MechaSettingsSchema);
  if (!result.ok) return {};
  return result.data;
}

/** Atomically write global mecha settings to mechaDir/settings.json. */
export function writeMechaSettings(mechaDir: string, settings: MechaSettings): void {
  MechaSettingsSchema.parse(settings);
  const filePath = join(mechaDir, SETTINGS_FILE);
  const tmp = filePath + `.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(tmp, JSON.stringify(settings, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, filePath);
}
/* v8 ignore stop */
