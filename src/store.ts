import { mkdirSync, existsSync, chmodSync, rmdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { safeReadJson } from "../shared/safe-read.js";
import { atomicWriteJson } from "../shared/atomic-write.js";
import { log } from "../shared/logger.js";

const MECHA_DIR = join(homedir(), ".mecha");
const REGISTRY_SCHEMA_VERSION = 1;
const SETTINGS_SCHEMA_VERSION = 1;

export function getMechaDir(): string {
  return MECHA_DIR;
}

export function ensureMechaDir(): void {
  mkdirSync(join(MECHA_DIR, "auth"), { recursive: true });
  mkdirSync(join(MECHA_DIR, "bots"), { recursive: true });
  // Ensure registry.json exists
  const regPath = join(MECHA_DIR, "registry.json");
  if (!existsSync(regPath)) {
    atomicWriteJson(regPath, { schema_version: REGISTRY_SCHEMA_VERSION, bots: {} });
  }
  try { chmodSync(regPath, 0o600); } catch { /* best-effort */ }
  // Ensure mecha.json exists with restrictive permissions
  const settingsPath = join(MECHA_DIR, "mecha.json");
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
  return join(MECHA_DIR, "registry.json");
}

const LOCK_DIR = join(MECHA_DIR, ".registry.lock");
const LOCK_STALE_MS = 30_000;

function withRegistryLock<T>(fn: () => T): T {
  const deadline = Date.now() + 5000;
  let acquired = false;
  while (true) {
    try {
      mkdirSync(LOCK_DIR);
      acquired = true;
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      // Check for stale lock
      try {
        const stat = statSync(LOCK_DIR);
        if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
          try { rmdirSync(LOCK_DIR); } catch { /* race with other process */ }
          continue;
        }
      } catch { /* lock dir gone, retry */ continue; }
      if (Date.now() >= deadline) {
        throw new Error("Registry lock timeout — another mecha process may be stuck. Remove ~/.mecha/.registry.lock manually if needed.");
      }
      // Brief spin wait
      const waitMs = 50;
      const start = Date.now();
      while (Date.now() - start < waitMs) { /* spin */ }
    }
  }
  try {
    return fn();
  } finally {
    if (acquired) {
      try { rmdirSync(LOCK_DIR); } catch { /* best-effort */ }
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
});

type MechaSettings = z.infer<typeof settingsSchema>;

export function readSettings(): MechaSettings {
  const result = safeReadJson(join(MECHA_DIR, "mecha.json"), "mecha.json", settingsSchema);
  if (!result.ok) {
    if (result.reason !== "missing") {
      log.warn(`Settings read failed: ${result.reason} — ${result.detail}`);
    }
    return { schema_version: SETTINGS_SCHEMA_VERSION };
  }
  return {
    schema_version: result.data.schema_version ?? SETTINGS_SCHEMA_VERSION,
    default_auth: result.data.default_auth,
    headscale_url: result.data.headscale_url,
    headscale_api_key: result.data.headscale_api_key,
    fleet_internal_secret: result.data.fleet_internal_secret,
  };
}

export function getOrCreateFleetInternalSecret(): string {
  const settingsPath = join(MECHA_DIR, "mecha.json");
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
}
