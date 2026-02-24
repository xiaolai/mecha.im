import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

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
  defaultProfile?: string;
}

function authStorePath(mechaDir: string): string {
  return join(mechaDir, "auth", "profiles.json");
}

function readStore(mechaDir: string): AuthStore {
  const path = authStorePath(mechaDir);
  if (!existsSync(path)) return { profiles: [] };
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as AuthStore;
  } catch {
    return { profiles: [] };
  }
}

function writeStore(mechaDir: string, store: AuthStore): void {
  const dir = join(mechaDir, "auth");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(authStorePath(mechaDir), JSON.stringify(store, null, 2), { mode: 0o600 });
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
    throw new Error(`Auth profile "${name}" already exists`);
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
  if (profile.isDefault) store.defaultProfile = name;
  writeStore(mechaDir, store);
  return profile;
}

export function mechaAuthLs(mechaDir: string): AuthProfile[] {
  return readStore(mechaDir).profiles;
}

export function mechaAuthDefault(mechaDir: string, name: string): void {
  const store = readStore(mechaDir);
  const profile = store.profiles.find((p) => p.name === name);
  if (!profile) throw new Error(`Auth profile "${name}" not found`);

  for (const p of store.profiles) p.isDefault = false;
  profile.isDefault = true;
  store.defaultProfile = name;
  writeStore(mechaDir, store);
}

export function mechaAuthRm(mechaDir: string, name: string): void {
  const store = readStore(mechaDir);
  const idx = store.profiles.findIndex((p) => p.name === name);
  if (idx === -1) throw new Error(`Auth profile "${name}" not found`);

  const wasDefault = store.profiles[idx]!.isDefault;
  store.profiles.splice(idx, 1);

  if (wasDefault && store.profiles.length > 0) {
    store.profiles[0]!.isDefault = true;
    store.defaultProfile = store.profiles[0]!.name;
  } else if (store.profiles.length === 0) {
    store.defaultProfile = undefined;
  }

  writeStore(mechaDir, store);
}

export function mechaAuthTag(mechaDir: string, name: string, tags: string[]): void {
  const store = readStore(mechaDir);
  const profile = store.profiles.find((p) => p.name === name);
  if (!profile) throw new Error(`Auth profile "${name}" not found`);

  profile.tags = tags;
  writeStore(mechaDir, store);
}

export function mechaAuthSwitch(mechaDir: string, name: string): AuthProfile {
  const store = readStore(mechaDir);
  const profile = store.profiles.find((p) => p.name === name);
  if (!profile) throw new Error(`Auth profile "${name}" not found`);

  for (const p of store.profiles) p.isDefault = false;
  profile.isDefault = true;
  store.defaultProfile = name;
  writeStore(mechaDir, store);
  return profile;
}

export function mechaAuthTest(mechaDir: string, name: string): { valid: boolean; profile: AuthProfile } {
  const store = readStore(mechaDir);
  const profile = store.profiles.find((p) => p.name === name);
  if (!profile) throw new Error(`Auth profile "${name}" not found`);

  // Basic validation — check token is non-empty
  const valid = profile.token.length > 0;
  return { valid, profile };
}

export function mechaAuthRenew(mechaDir: string, name: string, newToken: string): AuthProfile {
  const store = readStore(mechaDir);
  const profile = store.profiles.find((p) => p.name === name);
  if (!profile) throw new Error(`Auth profile "${name}" not found`);

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
