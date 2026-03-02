import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { MechaError } from "./errors.js";

const AUTH_CONFIG_FILE = "auth-config.json";

export interface AuthConfig {
  totp: boolean;
  apiKey: boolean;
}

export interface AuthConfigOverrides {
  totp?: boolean;
  apiKey?: boolean;
}

const DEFAULT_CONFIG: AuthConfig = { totp: true, apiKey: false };

/** Read auth config from file, returning defaults if missing. */
export function readAuthConfig(mechaDir: string): AuthConfig {
  const filePath = join(mechaDir, AUTH_CONFIG_FILE);
  try {
    const content = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(content) as Partial<AuthConfig>;
    return {
      totp: typeof parsed.totp === "boolean" ? parsed.totp : DEFAULT_CONFIG.totp,
      apiKey: typeof parsed.apiKey === "boolean" ? parsed.apiKey : DEFAULT_CONFIG.apiKey,
    };
  } catch (err: unknown) {
    // Missing file → use defaults; malformed/unreadable → propagate
    /* v8 ignore start -- non-ENOENT I/O errors are filesystem-dependent */
    if ((err as NodeJS.ErrnoException).code !== "ENOENT" && !(err instanceof SyntaxError)) throw err;
    /* v8 ignore stop */
    return { ...DEFAULT_CONFIG };
  }
}

/** Write auth config to file. Throws if both methods are disabled. */
export function writeAuthConfig(mechaDir: string, config: AuthConfig): void {
  validateAuthConfig(config);
  if (!existsSync(mechaDir)) {
    mkdirSync(mechaDir, { recursive: true });
  }
  const filePath = join(mechaDir, AUTH_CONFIG_FILE);
  writeFileSync(filePath, JSON.stringify(config, null, 2) + "\n");
}

/** Merge file config with CLI flag overrides. Throws if both disabled. */
export function resolveAuthConfig(mechaDir: string, overrides?: AuthConfigOverrides): AuthConfig {
  const base = readAuthConfig(mechaDir);
  const resolved: AuthConfig = {
    totp: overrides?.totp !== undefined ? overrides.totp : base.totp,
    apiKey: overrides?.apiKey !== undefined ? overrides.apiKey : base.apiKey,
  };
  validateAuthConfig(resolved);
  return resolved;
}

function validateAuthConfig(config: AuthConfig): void {
  if (!config.totp && !config.apiKey) {
    throw new MechaError(
      "At least one auth method must be enabled (TOTP or API key)",
      { code: "AUTH_CONFIG_INVALID", statusCode: 400, exitCode: 1 },
    );
  }
}
