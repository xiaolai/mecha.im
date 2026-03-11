import { readFileSync, mkdirSync, readdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { getMechaDir, readSettings } from "./store.js";
import { atomicWriteJson } from "../shared/atomic-write.js";
import { AuthProfileNotFoundError, AuthNotConfiguredError, InvalidNameError, MechaError } from "../shared/errors.js";
import { log } from "../shared/logger.js";
import { isValidName } from "../shared/validation.js";

const authProfileSchema = z.object({
  type: z.enum(["api_key", "tailscale"]),
  key: z.string().min(1),
});

type AuthProfile = z.infer<typeof authProfileSchema>;

function authDir(): string {
  return join(getMechaDir(), "auth");
}

function profilePath(name: string): string {
  if (!isValidName(name)) {
    throw new InvalidNameError(name);
  }
  return join(authDir(), `${name}.json`);
}

export function addAuthProfile(name: string, key: string): void {
  const type = key.startsWith("tskey-") ? "tailscale" : "api_key";
  const dir = authDir();
  mkdirSync(dir, { recursive: true });
  const path = profilePath(name);
  atomicWriteJson(path, { type, key });
  try { chmodSync(path, 0o600); } catch { /* best-effort */ }
}

export function getAuthProfile(name: string): AuthProfile {
  let raw: string;
  try {
    raw = readFileSync(profilePath(name), "utf-8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new AuthProfileNotFoundError(name);
    }
    throw err; // propagate permission/IO errors
  }
  const parsed = authProfileSchema.parse(JSON.parse(raw));
  return parsed;
}

export function listAuthProfiles(): string[] {
  try {
    return readdirSync(authDir())
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, ""));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return [];
    log.warn("Failed to list auth profiles", { error: err instanceof Error ? err.message : String(err) });
    return [];
  }
}

export interface ResolvedAuth {
  apiKey: string;
  source: string;
}

export function resolveAuth(authProfileName?: string): ResolvedAuth {
  // 1. Explicit profile
  if (authProfileName) {
    const profile = getAuthProfile(authProfileName);
    if (profile.type !== "api_key") {
      throw new AuthProfileNotFoundError(`"${authProfileName}" is not an API key profile`);
    }
    return { apiKey: profile.key, source: `profile:${authProfileName}` };
  }

  // 2. Default auth from mecha settings
  try {
    const settings = readSettings();
    if (settings.default_auth) {
      const profile = getAuthProfile(settings.default_auth);
      if (profile.type === "api_key") {
        return { apiKey: profile.key, source: `default:${settings.default_auth}` };
      }
    }
  } catch (err) {
    // Only skip if profile not found; propagate real errors (permission, corrupt)
    if (!(err instanceof MechaError && err.code === "AUTH_PROFILE_NOT_FOUND")) {
      throw err;
    }
  }

  // 3. Env var
  const envKey = process.env.ANTHROPIC_API_KEY;
  if (envKey) {
    return { apiKey: envKey, source: "env:ANTHROPIC_API_KEY" };
  }

  throw new AuthNotConfiguredError();
}
