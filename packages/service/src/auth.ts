import { existsSync, mkdirSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { AuthProfileNotFoundError, AuthProfileAlreadyExistsError, safeReadJson } from "@mecha/core";

export interface AuthProfile {
  name: string;
  type: "oauth" | "api-key";
  token: string;
  isDefault: boolean;
  tags: string[];
  createdAt: string;
}

interface AuthStore {
  profiles: AuthProfile[];
}

function authStorePath(mechaDir: string): string {
  return join(mechaDir, "auth", "profiles.json");
}

function readStore(mechaDir: string): AuthStore {
  const path = authStorePath(mechaDir);
  const result = safeReadJson<AuthStore>(path, "auth profiles");
  if (!result.ok) {
    if (result.reason !== "missing") {
      console.error(`[mecha] ${result.detail}`);
    }
    return { profiles: [] };
  }
  return result.data;
}

function writeStore(mechaDir: string, store: AuthStore): void {
  const dir = join(mechaDir, "auth");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  // Atomic write: temp file + rename to prevent corruption on crash
  const target = authStorePath(mechaDir);
  const tmp = target + "." + randomBytes(4).toString("hex") + ".tmp";
  writeFileSync(tmp, JSON.stringify(store, null, 2), { mode: 0o600 });
  renameSync(tmp, target);
}

export function mechaAuthAdd(
  mechaDir: string,
  name: string,
  type: "oauth" | "api-key",
  token: string,
  tags: string[] = [],
): AuthProfile {
  const store = readStore(mechaDir);
  const existing = store.profiles.find((p) => p.name === name);
  if (existing) {
    throw new AuthProfileAlreadyExistsError(name);
  }

  const profile: AuthProfile = {
    name,
    type,
    token,
    isDefault: store.profiles.length === 0,
    tags,
    createdAt: new Date().toISOString(),
  };

  store.profiles.push(profile);
  writeStore(mechaDir, store);
  return profile;
}

export function mechaAuthLs(mechaDir: string): AuthProfile[] {
  return readStore(mechaDir).profiles;
}

function _setDefaultProfile(store: AuthStore, name: string): AuthProfile {
  const profile = store.profiles.find((p) => p.name === name);
  if (!profile) throw new AuthProfileNotFoundError(name);
  for (const p of store.profiles) p.isDefault = false;
  profile.isDefault = true;
  return profile;
}

export function mechaAuthDefault(mechaDir: string, name: string): void {
  const store = readStore(mechaDir);
  _setDefaultProfile(store, name);
  writeStore(mechaDir, store);
}

export function mechaAuthRm(mechaDir: string, name: string): void {
  const store = readStore(mechaDir);
  const idx = store.profiles.findIndex((p) => p.name === name);
  if (idx === -1) throw new AuthProfileNotFoundError(name);

  const wasDefault = store.profiles[idx]!.isDefault;
  store.profiles.splice(idx, 1);

  if (wasDefault && store.profiles.length > 0) {
    store.profiles[0]!.isDefault = true;
  }

  writeStore(mechaDir, store);
}

export function mechaAuthTag(mechaDir: string, name: string, tags: string[]): void {
  const store = readStore(mechaDir);
  const profile = store.profiles.find((p) => p.name === name);
  if (!profile) throw new AuthProfileNotFoundError(name);

  profile.tags = tags;
  writeStore(mechaDir, store);
}

export function mechaAuthSwitch(mechaDir: string, name: string): AuthProfile {
  const store = readStore(mechaDir);
  const profile = _setDefaultProfile(store, name);
  writeStore(mechaDir, store);
  return profile;
}

export function mechaAuthTest(mechaDir: string, name: string): { valid: boolean; profile: AuthProfile } {
  const store = readStore(mechaDir);
  const profile = store.profiles.find((p) => p.name === name);
  if (!profile) throw new AuthProfileNotFoundError(name);

  // Basic validation — check token is non-empty
  const valid = profile.token.length > 0;
  return { valid, profile };
}

export function mechaAuthRenew(mechaDir: string, name: string, newToken: string): AuthProfile {
  const store = readStore(mechaDir);
  const profile = store.profiles.find((p) => p.name === name);
  if (!profile) throw new AuthProfileNotFoundError(name);

  profile.token = newToken;
  writeStore(mechaDir, store);
  return profile;
}

export function mechaAuthGet(mechaDir: string, name: string): AuthProfile | undefined {
  return readStore(mechaDir).profiles.find((p) => p.name === name);
}

export function mechaAuthGetDefault(mechaDir: string): AuthProfile | undefined {
  const store = readStore(mechaDir);
  return store.profiles.find((p) => p.isDefault);
}
