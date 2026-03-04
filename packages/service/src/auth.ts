import { mkdirSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import {
  AuthProfileNotFoundError,
  AuthProfileAlreadyExistsError,
  InvalidNameError,
  readAuthProfiles,
  readAuthCredentials,
  isValidProfileName,
  BotNotFoundError,
  updateBotConfig,
} from "@mecha/core";
import type {
  AuthProfileStore,
  AuthCredentialStore,
  AuthProfileMeta,
  BotName,
} from "@mecha/core";
import type { ProcessManager } from "@mecha/process";

/** Public profile view returned by service functions (includes isDefault). */
export interface AuthProfile {
  name: string;
  type: "oauth" | "api-key";
  account: string | null;
  label: string;
  isDefault: boolean;
  tags: string[];
  expiresAt: number | null;
  createdAt: string;
}

/** Options for creating an auth profile. */
export interface AuthAddOpts {
  name: string;
  type: "oauth" | "api-key";
  token: string;
  account?: string | null;
  label?: string;
  tags?: string[];
  expiresAt?: number | null;
}

// --- Internal helpers ---

function authDir(mechaDir: string): string {
  return join(mechaDir, "auth");
}

function atomicWrite(filePath: string, data: string, mode: number): void {
  const tmp = filePath + "." + randomBytes(4).toString("hex") + ".tmp";
  writeFileSync(tmp, data, { mode });
  try {
    renameSync(tmp, filePath);
  /* v8 ignore start -- rename failure on same-device is rare; cleanup is best-effort */
  } catch (err) {
    try { unlinkSync(tmp); } catch { /* ignore cleanup failure */ }
    throw err;
  }
  /* v8 ignore stop */
}

function writeProfiles(mechaDir: string, store: AuthProfileStore): void {
  const dir = authDir(mechaDir);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  atomicWrite(join(dir, "profiles.json"), JSON.stringify(store, null, 2), 0o600);
}

function writeCredentials(mechaDir: string, creds: AuthCredentialStore): void {
  const dir = authDir(mechaDir);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  atomicWrite(join(dir, "credentials.json"), JSON.stringify(creds, null, 2), 0o600);
}

function toPublicProfile(name: string, meta: Omit<AuthProfileMeta, "name">, defaultName: string | null): AuthProfile {
  return {
    name,
    type: meta.type,
    account: meta.account,
    label: meta.label,
    isDefault: name === defaultName,
    tags: meta.tags,
    expiresAt: meta.expiresAt,
    createdAt: meta.createdAt,
  };
}

// --- Public API ---

export function mechaAuthAdd(
  mechaDir: string,
  name: string,
  type: "oauth" | "api-key",
  token: string,
  tags: string[] = [],
): AuthProfile {
  return mechaAuthAddFull(mechaDir, { name, type, token, tags });
}

export function mechaAuthAddFull(mechaDir: string, opts: AuthAddOpts): AuthProfile {
  if (!isValidProfileName(opts.name)) {
    throw new InvalidNameError(opts.name);
  }

  const store = readAuthProfiles(mechaDir);
  const creds = readAuthCredentials(mechaDir);

  if (store.profiles[opts.name]) {
    throw new AuthProfileAlreadyExistsError(opts.name);
  }

  const isFirst = Object.keys(store.profiles).length === 0;
  /* v8 ignore start -- null coalescing defaults for optional fields */
  const meta: Omit<AuthProfileMeta, "name"> = {
    type: opts.type,
    account: opts.account ?? null,
    label: opts.label ?? "",
    tags: opts.tags ?? [],
    expiresAt: opts.expiresAt ?? null,
    createdAt: new Date().toISOString(),
  };
  /* v8 ignore stop */

  store.profiles[opts.name] = meta;
  if (isFirst || store.default === null) {
    store.default = opts.name;
  }

  creds[opts.name] = { token: opts.token };

  // Best-effort dual-write: if credentials write fails, revert profiles
  const prevStore = readAuthProfiles(mechaDir);
  writeProfiles(mechaDir, store);
  try {
    writeCredentials(mechaDir, creds);
  /* v8 ignore start -- credentials write failure after profiles write */
  } catch (err) {
    writeProfiles(mechaDir, prevStore);
    throw err;
  }
  /* v8 ignore stop */

  return toPublicProfile(opts.name, meta, store.default);
}

export function mechaAuthLs(mechaDir: string): AuthProfile[] {
  const store = readAuthProfiles(mechaDir);
  const result = Object.entries(store.profiles).map(([name, meta]) =>
    toPublicProfile(name, meta, store.default),
  );

  // Append synthetic profiles for env vars
  /* v8 ignore start -- env var detection depends on deployment environment */
  const envEntries = [
    { name: "$env:api-key", type: "api-key" as const, envVar: "ANTHROPIC_API_KEY", label: "ANTHROPIC_API_KEY (env)" },
    { name: "$env:oauth", type: "oauth" as const, envVar: "CLAUDE_CODE_OAUTH_TOKEN", label: "CLAUDE_CODE_OAUTH_TOKEN (env)" },
  ];
  for (const e of envEntries) {
    if (process.env[e.envVar]) {
      result.push({
        name: e.name,
        type: e.type,
        account: null,
        label: e.label,
        isDefault: false,
        tags: ["env"],
        expiresAt: null,
        createdAt: "",
      });
    }
  }
  /* v8 ignore stop */

  return result;
}

export function mechaAuthDefault(mechaDir: string, name: string): void {
  const store = readAuthProfiles(mechaDir);
  if (!store.profiles[name]) throw new AuthProfileNotFoundError(name);
  store.default = name;
  writeProfiles(mechaDir, store);
}

export function mechaAuthRm(mechaDir: string, name: string): void {
  const store = readAuthProfiles(mechaDir);
  const creds = readAuthCredentials(mechaDir);

  if (!store.profiles[name]) throw new AuthProfileNotFoundError(name);

  const wasDefault = store.default === name;
  delete store.profiles[name];
  delete creds[name];

  if (wasDefault) {
    const remaining = Object.keys(store.profiles);
    store.default = remaining.length > 0 ? remaining[0]! : null;
  }

  // Best-effort dual-write: if credentials write fails, revert profiles
  const prevStore = readAuthProfiles(mechaDir);
  writeProfiles(mechaDir, store);
  try {
    writeCredentials(mechaDir, creds);
  /* v8 ignore start -- credentials write failure after profiles write */
  } catch (err) {
    writeProfiles(mechaDir, prevStore);
    throw err;
  }
  /* v8 ignore stop */
}

export function mechaAuthTag(mechaDir: string, name: string, tags: string[]): void {
  const store = readAuthProfiles(mechaDir);
  const meta = store.profiles[name];
  if (!meta) throw new AuthProfileNotFoundError(name);

  meta.tags = tags;
  writeProfiles(mechaDir, store);
}

export function mechaAuthSwitch(mechaDir: string, name: string): AuthProfile {
  const store = readAuthProfiles(mechaDir);
  const meta = store.profiles[name];
  if (!meta) throw new AuthProfileNotFoundError(name);
  store.default = name;
  writeProfiles(mechaDir, store);
  return toPublicProfile(name, meta, store.default);
}

export function mechaAuthTest(mechaDir: string, name: string): { valid: boolean; profile: AuthProfile } {
  const store = readAuthProfiles(mechaDir);
  const meta = store.profiles[name];
  if (!meta) throw new AuthProfileNotFoundError(name);

  const creds = readAuthCredentials(mechaDir);
  const cred = creds[name];
  const valid = !!cred && cred.token.length > 0;
  return { valid, profile: toPublicProfile(name, meta, store.default) };
}

export function mechaAuthRenew(mechaDir: string, name: string, newToken: string): AuthProfile {
  const store = readAuthProfiles(mechaDir);
  const meta = store.profiles[name];
  if (!meta) throw new AuthProfileNotFoundError(name);

  const creds = readAuthCredentials(mechaDir);
  creds[name] = { token: newToken };
  writeCredentials(mechaDir, creds);

  return toPublicProfile(name, meta, store.default);
}

export function mechaAuthGet(mechaDir: string, name: string): AuthProfile | undefined {
  const store = readAuthProfiles(mechaDir);
  const meta = store.profiles[name];
  if (!meta) return undefined;
  return toPublicProfile(name, meta, store.default);
}

export function mechaAuthGetDefault(mechaDir: string): AuthProfile | undefined {
  const store = readAuthProfiles(mechaDir);
  if (!store.default) return undefined;
  const meta = store.profiles[store.default];
  /* v8 ignore start -- defensive: default points to deleted profile */
  if (!meta) return undefined;
  /* v8 ignore stop */
  return toPublicProfile(store.default, meta, store.default);
}

export function mechaAuthSwitchBot(
  mechaDir: string,
  pm: ProcessManager,
  botName: BotName,
  profileName: string,
): AuthProfile {
  // Env sentinel profiles — skip store lookup
  /* v8 ignore start -- $env: sentinel requires env vars set at test time */
  if (profileName.startsWith("$env:")) {
    const envMap: Record<string, { type: "oauth" | "api-key"; envVar: string; label: string }> = {
      "$env:api-key": { type: "api-key", envVar: "ANTHROPIC_API_KEY", label: "ANTHROPIC_API_KEY (env)" },
      "$env:oauth": { type: "oauth", envVar: "CLAUDE_CODE_OAUTH_TOKEN", label: "CLAUDE_CODE_OAUTH_TOKEN (env)" },
    };
    const entry = envMap[profileName];
    if (!entry || !process.env[entry.envVar]) throw new AuthProfileNotFoundError(profileName);

    const info = pm.get(botName);
    if (!info) throw new BotNotFoundError(botName);

    updateBotConfig(join(mechaDir, botName), { auth: profileName });
    return {
      name: profileName,
      type: entry.type,
      account: null,
      label: entry.label,
      isDefault: false,
      tags: ["env"],
      expiresAt: null,
      createdAt: "",
    };
  }
  /* v8 ignore stop */

  // Validate stored profile exists
  const store = readAuthProfiles(mechaDir);
  const meta = store.profiles[profileName];
  if (!meta) throw new AuthProfileNotFoundError(profileName);

  // Validate bot exists
  const info = pm.get(botName);
  if (!info) throw new BotNotFoundError(botName);

  // Update bot config.json with auth field
  updateBotConfig(join(mechaDir, botName), { auth: profileName });

  return toPublicProfile(profileName, meta, store.default);
}

