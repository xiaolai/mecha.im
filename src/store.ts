import { mkdirSync, existsSync, chmodSync, rmdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { safeReadJson } from "../shared/safe-read.js";
import { atomicWriteJson } from "../shared/atomic-write.js";
import { log } from "../shared/logger.js";
import { getMutex } from "../shared/mutex.js";

const settingsMutex = getMutex("mecha-settings");

const DEFAULT_MECHA_DIR = join(homedir(), ".mecha");
const REGISTRY_SCHEMA_VERSION = 1;
const SETTINGS_SCHEMA_VERSION = 1;

export function getMechaDir(): string {
  return process.env.MECHA_HOME ?? DEFAULT_MECHA_DIR;
}

export function ensureMechaDir(): void {
  mkdirSync(join(getMechaDir(), "bots"), { recursive: true });
  // Ensure registry.json exists
  const regPath = join(getMechaDir(), "registry.json");
  if (!existsSync(regPath)) {
    atomicWriteJson(regPath, { schema_version: REGISTRY_SCHEMA_VERSION, bots: {} });
  }
  try { chmodSync(regPath, 0o600); } catch { /* best-effort */ }
  // Ensure mecha.json exists with restrictive permissions
  const settingsPath = join(getMechaDir(), "mecha.json");
  if (!existsSync(settingsPath)) {
    atomicWriteJson(settingsPath, { schema_version: SETTINGS_SCHEMA_VERSION });
  }
  try { chmodSync(settingsPath, 0o600); } catch { /* best-effort */ }
}

// --- Registry ---

const registrySchema = z.object({
  schema_version: z.number().int().optional(),
  bots: z.record(z.string(), z.object({
    path: z.string(),
    config: z.string().optional(),
    containerId: z.string().optional(),
    model: z.string().optional(),
    botToken: z.string().optional(),
    createdAt: z.string().optional(),
  })),
});

type Registry = z.infer<typeof registrySchema>;

function registryPath(): string {
  return join(getMechaDir(), "registry.json");
}

function lockDir(): string { return join(getMechaDir(), ".registry.lock"); }
const LOCK_STALE_MS = 30_000;

function withRegistryLock<T>(fn: () => T): T {
  const deadline = Date.now() + 5000;
  let acquired = false;
  while (true) {
    try {
      mkdirSync(lockDir());
      acquired = true;
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      // Check for stale lock
      try {
        const stat = statSync(lockDir());
        if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
          try { rmdirSync(lockDir()); } catch { /* race with other process */ }
          continue;
        }
      } catch { /* lock dir gone, retry */ continue; }
      if (Date.now() >= deadline) {
        throw new Error("Registry lock timeout — another mecha process may be stuck. Remove ~/.mecha/.registry.lock manually if needed.");
      }
      // Synchronous wait — we need this to be sync for withRegistryLock.
      // Use Atomics.wait on a dummy buffer for a non-spinning delay.
      const waitMs = 10;
      try {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, waitMs);
      } catch {
        // Fallback: brief spin (environments without SharedArrayBuffer)
        const start = Date.now();
        while (Date.now() - start < waitMs) { /* spin */ }
      }
    }
  }
  try {
    return fn();
  } finally {
    if (acquired) {
      try { rmdirSync(lockDir()); } catch { /* best-effort */ }
    }
  }
}

function readRegistry(): Registry {
  const result = safeReadJson(registryPath(), "registry", registrySchema);
  if (!result.ok) {
    if (result.reason !== "missing") {
      log.warn(`Registry read failed: ${result.reason} — ${result.detail}`);
    }
    return { schema_version: REGISTRY_SCHEMA_VERSION, bots: {} };
  }
  return {
    schema_version: result.data.schema_version ?? REGISTRY_SCHEMA_VERSION,
    bots: result.data.bots,
  };
}

export function getBot(name: string): Registry["bots"][string] | undefined {
  return readRegistry().bots[name];
}

export function setBot(name: string, entry: Registry["bots"][string]): void {
  withRegistryLock(() => {
    const reg = readRegistry();
    reg.schema_version = REGISTRY_SCHEMA_VERSION;
    reg.bots[name] = entry;
    atomicWriteJson(registryPath(), reg);
    try { chmodSync(registryPath(), 0o600); } catch { /* best-effort */ }
  });
}

export function removeBot(name: string): void {
  withRegistryLock(() => {
    const reg = readRegistry();
    reg.schema_version = REGISTRY_SCHEMA_VERSION;
    delete reg.bots[name];
    atomicWriteJson(registryPath(), reg);
  });
}

export function listBots(): Registry["bots"] {
  return readRegistry().bots;
}

// --- Settings ---

const settingsSchema = z.object({
  schema_version: z.number().int().optional(),
  default_auth: z.string().optional(),
  headscale_url: z.string().url().optional(),
  headscale_api_key: z.string().optional(),
  fleet_internal_secret: z.string().optional(),
  totp_secret: z.string().optional(),
});

type MechaSettings = z.infer<typeof settingsSchema>;

export function readSettings(): MechaSettings {
  const result = safeReadJson(join(getMechaDir(), "mecha.json"), "mecha.json", settingsSchema);
  if (!result.ok) {
    if (result.reason !== "missing") {
      log.warn(`Settings read failed: ${result.reason} — ${result.detail}`);
    }
    return { schema_version: SETTINGS_SCHEMA_VERSION };
  }
  return { ...result.data, schema_version: result.data.schema_version ?? SETTINGS_SCHEMA_VERSION };
}

export function getOrCreateFleetInternalSecret(): string {
  const settingsPath = join(getMechaDir(), "mecha.json");
  // Use blocking spin-acquire to prevent concurrent secret generation race
  let release: (() => void) | null = null;
  for (let i = 0; i < 100; i++) {
    release = settingsMutex.tryAcquire();
    if (release) break;
    // Spin-wait 10ms (synchronous context, can't use await)
    const end = Date.now() + 10;
    while (Date.now() < end) { /* spin */ }
  }
  try {
    const settings = readSettings();
    if (settings.fleet_internal_secret) return settings.fleet_internal_secret;

    const fleetInternalSecret = randomBytes(24).toString("hex");
    atomicWriteJson(settingsPath, {
      ...settings,
      schema_version: SETTINGS_SCHEMA_VERSION,
      fleet_internal_secret: fleetInternalSecret,
    });
    try { chmodSync(settingsPath, 0o600); } catch { /* best-effort */ }
    return fleetInternalSecret;
  } finally {
    release?.();
  }
}

/** Write settings with synchronization to prevent concurrent clobber */
function writeSettingsSafe(updater: (settings: Record<string, unknown>) => Record<string, unknown>): void {
  const settingsPath = join(getMechaDir(), "mecha.json");
  let release: (() => void) | null = null;
  for (let i = 0; i < 100; i++) {
    release = settingsMutex.tryAcquire();
    if (release) break;
    const end = Date.now() + 10;
    while (Date.now() < end) { /* spin */ }
  }
  try {
    const settings = readSettings();
    atomicWriteJson(settingsPath, {
      ...updater(settings),
      schema_version: SETTINGS_SCHEMA_VERSION,
    });
    try { chmodSync(settingsPath, 0o600); } catch { /* best-effort */ }
  } finally {
    release?.();
  }
}

// --- TOTP ---

export function getTotpSecret(): string | undefined {
  return readSettings().totp_secret;
}

export function setTotpSecret(secret: string): void {
  writeSettingsSafe((settings) => ({ ...settings, totp_secret: secret }));
}

export function clearTotpSecret(): void {
  writeSettingsSafe((settings) => {
    const { totp_secret: _, ...rest } = settings;
    return rest;
  });
}
