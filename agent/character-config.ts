import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { PATHS } from "./paths.js";

export interface CharacterConfig {
  skin: number;
  hair: number;
  outfit: string;
}

const DEFAULTS: CharacterConfig = { skin: 0, hair: 0, outfit: "outfit1" };
const OUTFIT_RE = /^(outfit[1-6]|suit[1-4])$/;

export function validateCharacter(c: unknown): c is CharacterConfig {
  if (!c || typeof c !== "object") return false;
  const obj = c as Record<string, unknown>;
  if (typeof obj.skin !== "number" || !Number.isInteger(obj.skin) || obj.skin < 0 || obj.skin > 5) return false;
  if (typeof obj.hair !== "number" || !Number.isInteger(obj.hair) || obj.hair < 0 || obj.hair > 7) return false;
  if (typeof obj.outfit !== "string" || !OUTFIT_RE.test(obj.outfit)) return false;
  return true;
}

export function readCharacter(): CharacterConfig {
  try {
    const raw = readFileSync(PATHS.characterConfig, "utf-8");
    const parsed = JSON.parse(raw);
    return validateCharacter(parsed) ? parsed : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

export function writeCharacter(config: CharacterConfig): void {
  mkdirSync(dirname(PATHS.characterConfig), { recursive: true });
  writeFileSync(PATHS.characterConfig, JSON.stringify(config, null, 2));
}
