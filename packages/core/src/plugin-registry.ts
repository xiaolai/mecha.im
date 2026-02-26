import { writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { isValidName } from "./validation.js";
import { MechaError, InvalidNameError, CorruptConfigError } from "./errors.js";
import { safeReadJson } from "./safe-read.js";
import { ALL_CAPABILITIES } from "./acl/types.js";

const PLUGINS_FILE = "plugins.json";

/** Current plugin registry schema version */
export const PLUGIN_REGISTRY_VERSION = 1;

/** Object prototype keys that must never be used as plugin names */
const DANGEROUS_KEYS = ["__proto__", "constructor", "toString", "valueOf", "hasOwnProperty"];

/** Names that cannot be used as plugin names (capabilities + internal + dangerous keys) */
export const RESERVED_PLUGIN_NAMES: readonly string[] = [
  ...ALL_CAPABILITIES,
  "mecha",
  "mecha-workspace",
  ...DANGEROUS_KEYS,
];

// --- Branded type ---

export type PluginName = string & { __brand: "PluginName" };

/**
 * Validate and brand a string as a PluginName.
 * @throws InvalidNameError if the input is invalid
 * @throws PluginNameReservedError if the name is reserved
 */
export function pluginName(input: string): PluginName {
  if (!isValidName(input)) throw new InvalidNameError(input);
  if (RESERVED_PLUGIN_NAMES.includes(input)) {
    throw new PluginNameReservedError(input);
  }
  return input as PluginName;
}

// --- Zod schemas ---

export const StdioPluginInputSchema = z.object({
  type: z.literal("stdio"),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  description: z.string().optional(),
});

export const HttpPluginInputSchema = z.object({
  type: z.enum(["http", "sse"]),
  url: z.string().url(),
  headers: z.record(z.string()).optional(),
  description: z.string().optional(),
});

export const PluginInputSchema = z.discriminatedUnion("type", [
  StdioPluginInputSchema,
  HttpPluginInputSchema,
]);

// --- Config types ---

export interface PluginConfigBase {
  description?: string;
  addedAt: string;
}

export interface StdioPluginConfig extends PluginConfigBase {
  type: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface HttpPluginConfig extends PluginConfigBase {
  type: "http" | "sse";
  url: string;
  headers?: Record<string, string>;
}

export type PluginConfig = StdioPluginConfig | HttpPluginConfig;

export interface PluginRegistry {
  version: 1;
  plugins: Record<string, PluginConfig>;
}

// --- Stored schema for reading from disk ---

const PluginConfigSchema: z.ZodType<PluginConfig> = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("stdio"),
    command: z.string(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string()).optional(),
    description: z.string().optional(),
    addedAt: z.string(),
  }),
  z.object({
    type: z.enum(["http", "sse"]),
    url: z.string(),
    headers: z.record(z.string()).optional(),
    description: z.string().optional(),
    addedAt: z.string(),
  }),
]);

const PluginRegistrySchema = z.object({
  version: z.literal(1),
  plugins: z.record(PluginConfigSchema),
});

// --- Errors ---

export class PluginNameReservedError extends MechaError {
  constructor(name: string) {
    super(`Plugin name "${name}" is reserved (it's a built-in capability or internal name)`, {
      code: "PLUGIN_NAME_RESERVED", statusCode: 400, exitCode: 1,
    });
  }
}

export class PluginNotFoundError extends MechaError {
  constructor(name: string) {
    super(`Plugin "${name}" not found`, {
      code: "PLUGIN_NOT_FOUND", statusCode: 404, exitCode: 1,
    });
  }
}

export class PluginAlreadyExistsError extends MechaError {
  constructor(name: string) {
    super(`Plugin "${name}" already exists (use --force to overwrite)`, {
      code: "PLUGIN_ALREADY_EXISTS", statusCode: 409, exitCode: 1,
    });
  }
}

export class PluginEnvError extends MechaError {
  constructor(message: string) {
    super(message, {
      code: "PLUGIN_ENV_ERROR", statusCode: 400, exitCode: 1,
    });
  }
}

// --- Registry read/write ---

function pluginsPath(mechaDir: string): string {
  return join(mechaDir, PLUGINS_FILE);
}

/** Read the plugin registry. Returns empty registry if file doesn't exist. */
export function readPluginRegistry(mechaDir: string): PluginRegistry {
  const path = pluginsPath(mechaDir);
  const result = safeReadJson(path, "plugin registry", PluginRegistrySchema);
  if (!result.ok) {
    if (result.reason === "missing") {
      return { version: 1, plugins: {} };
    }
    /* v8 ignore start -- corrupt/unreadable registry fallback */
    throw new CorruptConfigError(`plugin registry: ${result.detail}`);
    /* v8 ignore stop */
  }
  return result.data;
}

/** Write the plugin registry to disk (atomic: temp file + rename). */
export function writePluginRegistry(mechaDir: string, registry: PluginRegistry): void {
  const path = pluginsPath(mechaDir);
  const tmp = path + `.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(tmp, JSON.stringify(registry, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, path);
}

/** Add a plugin to the registry. */
export function addPlugin(
  mechaDir: string,
  name: PluginName,
  config: PluginConfig,
  force = false,
): void {
  const registry = readPluginRegistry(mechaDir);
  if (Object.hasOwn(registry.plugins, name) && !force) {
    throw new PluginAlreadyExistsError(name);
  }
  registry.plugins[name] = config;
  writePluginRegistry(mechaDir, registry);
}

/** Remove a plugin from the registry. Returns false if not found. */
export function removePlugin(mechaDir: string, name: string): boolean {
  if (!isValidName(name)) throw new InvalidNameError(name);
  const registry = readPluginRegistry(mechaDir);
  if (!Object.hasOwn(registry.plugins, name)) return false;
  delete registry.plugins[name];
  writePluginRegistry(mechaDir, registry);
  return true;
}

/** Get a single plugin config by name. */
export function getPlugin(mechaDir: string, name: string): PluginConfig | undefined {
  if (!isValidName(name)) throw new InvalidNameError(name);
  const registry = readPluginRegistry(mechaDir);
  if (!Object.hasOwn(registry.plugins, name)) return undefined;
  return registry.plugins[name];
}

/** List all plugin names and configs. */
export function listPlugins(mechaDir: string): Array<{ name: string; config: PluginConfig }> {
  const registry = readPluginRegistry(mechaDir);
  return Object.entries(registry.plugins).map(([name, config]) => ({ name, config }));
}

/** Check if a name is a registered plugin (not a capability). */
export function isPluginName(mechaDir: string, name: string): boolean {
  if (!isValidName(name)) return false;
  const registry = readPluginRegistry(mechaDir);
  return Object.hasOwn(registry.plugins, name);
}
