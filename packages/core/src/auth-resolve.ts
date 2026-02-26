import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AuthProfileNotFoundError, AuthTokenInvalidError } from "./errors.js";

/** Auth profile metadata stored in profiles.json */
export interface AuthProfileMeta {
  name: string;
  type: "oauth" | "api-key";
  account: string | null;
  label: string;
  tags: string[];
  expiresAt: number | null;
  createdAt: string;
}

/** Stored format of profiles.json */
export interface AuthProfileStore {
  default: string | null;
  profiles: Record<string, Omit<AuthProfileMeta, "name">>;
}

/** Stored format of credentials.json */
export interface AuthCredentialStore {
  [name: string]: { token: string };
}

/** Result of resolving auth for a CASA */
export interface ResolvedAuth {
  profileName: string;
  type: "oauth" | "api-key";
  envVar: "CLAUDE_CODE_OAUTH_TOKEN" | "ANTHROPIC_API_KEY";
  token: string;
}

/** Dangerous keys that must never be used as profile names. */
const RESERVED_KEYS = new Set(["__proto__", "constructor", "prototype", "toString", "valueOf"]);

/* v8 ignore start -- defensive shape validation for parsed JSON */
/** Check if a value looks like a valid AuthProfileStore. */
function isAuthProfileStore(v: unknown): v is AuthProfileStore {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  if (typeof o.profiles !== "object" || o.profiles === null) return false;
  if (o.default !== null && typeof o.default !== "string") return false;
  return true;
}

/** Check if a value looks like a valid AuthCredentialStore. */
function isAuthCredentialStore(v: unknown): v is AuthCredentialStore {
  if (typeof v !== "object" || v === null) return false;
  return true;
}
/* v8 ignore stop */

/* v8 ignore start -- defensive validation: tested via service layer (InvalidNameError tests) */
/** Validate a profile name: lowercase alphanumeric + hyphens, no reserved keys. */
export function isValidProfileName(name: string): boolean {
  if (RESERVED_KEYS.has(name)) return false;
  return /^[a-z0-9][a-z0-9-]*$/.test(name) && name.length <= 64;
}
/* v8 ignore stop */

/** Read profiles.json — returns empty store on missing/corrupt */
export function readAuthProfiles(mechaDir: string): AuthProfileStore {
  const path = join(mechaDir, "auth", "profiles.json");
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8"));
    /* v8 ignore start -- defensive: malformed but parseable JSON */
    if (!isAuthProfileStore(parsed)) return { default: null, profiles: {} };
    /* v8 ignore stop */
    return parsed;
  } catch {
    return { default: null, profiles: {} };
  }
}

/** Read credentials.json — returns empty object on missing/corrupt */
export function readAuthCredentials(mechaDir: string): AuthCredentialStore {
  const path = join(mechaDir, "auth", "credentials.json");
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8"));
    /* v8 ignore start -- defensive: malformed but parseable JSON */
    if (!isAuthCredentialStore(parsed)) return {};
    /* v8 ignore stop */
    return parsed;
  } catch {
    return {};
  }
}

/**
 * Map profile type to the correct SDK environment variable.
 */
export function authEnvVar(type: "oauth" | "api-key"): "CLAUDE_CODE_OAUTH_TOKEN" | "ANTHROPIC_API_KEY" {
  return type === "oauth" ? "CLAUDE_CODE_OAUTH_TOKEN" : "ANTHROPIC_API_KEY";
}

/**
 * Resolve auth credentials for a CASA.
 *
 * Resolution chain:
 * 1. Explicit profile name → look up → error if not found
 * 2. No explicit name → default profile → error if none set
 * 3. No profiles at all → clear error
 *
 * Returns null only when authProfileName is explicitly null (--no-auth).
 */
export function resolveAuth(mechaDir: string, authProfileName?: string | null): ResolvedAuth | null {
  // Explicit --no-auth
  if (authProfileName === null) return null;

  const store = readAuthProfiles(mechaDir);
  const creds = readAuthCredentials(mechaDir);

  // Determine which profile to use
  const targetName = authProfileName ?? store.default;

  if (!targetName) {
    const hasProfiles = Object.keys(store.profiles).length > 0;
    /* v8 ignore start -- message varies by profile state */
    const hint = hasProfiles
      ? "no default profile set — run: mecha auth default <name>"
      : "no default profile set — run: mecha auth add <name> --oauth --token <token>";
    /* v8 ignore stop */
    throw new AuthProfileNotFoundError(hint);
  }

  const meta = store.profiles[targetName];
  if (!meta) {
    throw new AuthProfileNotFoundError(targetName);
  }

  const cred = creds[targetName];
  /* v8 ignore start -- !cred.token branch tested via service/auth.test.ts (mechaAuthProbe empty token) */
  if (!cred || !cred.token) {
    throw new AuthTokenInvalidError(targetName);
  }
  /* v8 ignore stop */

  return {
    profileName: targetName,
    type: meta.type,
    envVar: authEnvVar(meta.type),
    token: cred.token,
  };
}

/** List all profiles with metadata (no tokens). */
export function listAuthProfiles(mechaDir: string): AuthProfileMeta[] {
  const store = readAuthProfiles(mechaDir);
  return Object.entries(store.profiles).map(([name, meta]) => ({
    name,
    ...meta,
  }));
}

/** Get the default profile name, or null. */
export function getDefaultProfileName(mechaDir: string): string | null {
  return readAuthProfiles(mechaDir).default;
}
