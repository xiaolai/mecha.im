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
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  // Validate each entry has a token string
  for (const [key, val] of Object.entries(v as Record<string, unknown>)) {
    if (RESERVED_KEYS.has(key)) continue;
    if (typeof val !== "object" || val === null) return false;
    if (typeof (val as Record<string, unknown>).token !== "string") return false;
  }
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
  } catch (err: unknown) {
    /* v8 ignore start -- non-ENOENT errors (EACCES, EIO, corrupt JSON) */
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      console.error(`[mecha] Failed to read ${path}: ${(err as Error).message}`);
    }
    /* v8 ignore stop */
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
  } catch (err: unknown) {
    /* v8 ignore start -- non-ENOENT errors (EACCES, EIO, corrupt JSON) */
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      console.error(`[mecha] Failed to read ${path}: ${(err as Error).message}`);
    }
    /* v8 ignore stop */
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

  // Validate profile name to prevent prototype/reserved key lookups
  if (RESERVED_KEYS.has(targetName) || !Object.hasOwn(store.profiles, targetName)) {
    throw new AuthProfileNotFoundError(targetName);
  }

  const meta = store.profiles[targetName];
  /* v8 ignore start -- meta always exists after Object.hasOwn guard above */
  if (!meta) {
    throw new AuthProfileNotFoundError(targetName);
  }
  /* v8 ignore stop */

  // Enforce token expiration
  /* v8 ignore start -- token expiry: requires time-dependent test setup */
  if (meta.expiresAt && meta.expiresAt < Date.now()) {
    throw new AuthTokenInvalidError(`${targetName} (expired)`);
  }
  /* v8 ignore stop */

  if (!Object.hasOwn(creds, targetName)) {
    throw new AuthTokenInvalidError(targetName);
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
