import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { MechaError } from "./errors.js";

const AUTH_CONFIG_FILE = "auth-config.json";

export interface AuthConfig {
  totp: boolean;
}

export interface AuthConfigOverrides {
  totp?: boolean;
}

const DEFAULT_CONFIG: AuthConfig = { totp: true };

/** Read auth config from file, returning defaults if missing. */
export function readAuthConfig(mechaDir: string): AuthConfig {
  const filePath = join(mechaDir, AUTH_CONFIG_FILE);
  try {
    const content = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(content) as Partial<AuthConfig>;
    return {
      totp: typeof parsed.totp === "boolean" ? parsed.totp : DEFAULT_CONFIG.totp,
    };
  } catch (err: unknown) {
    // Missing file → use defaults; malformed/unreadable → propagate
    /* v8 ignore start -- non-ENOENT I/O errors are filesystem-dependent */
    if ((err as NodeJS.ErrnoException).code !== "ENOENT" && !(err instanceof SyntaxError)) throw err;
    /* v8 ignore stop */
    return { ...DEFAULT_CONFIG };
  }
}

/** Write auth config to file. Throws if TOTP is disabled. */
export function writeAuthConfig(mechaDir: string, config: AuthConfig): void {
  validateAuthConfig(config);
  if (!existsSync(mechaDir)) {
    mkdirSync(mechaDir, { recursive: true });
  }
  const filePath = join(mechaDir, AUTH_CONFIG_FILE);
  writeFileSync(filePath, JSON.stringify(config, null, 2) + "\n");
}

/** Merge file config with CLI flag overrides. Throws if TOTP disabled. */
export function resolveAuthConfig(mechaDir: string, overrides?: AuthConfigOverrides): AuthConfig {
  const base = readAuthConfig(mechaDir);
  const resolved: AuthConfig = {
    totp: overrides?.totp !== undefined ? overrides.totp : base.totp,
  };
  validateAuthConfig(resolved);
  return resolved;
}

function validateAuthConfig(config: AuthConfig): void {
  if (!config.totp) {
    throw new MechaError(
      "TOTP must be enabled",
      { code: "AUTH_CONFIG_INVALID", statusCode: 400, exitCode: 1 },
    );
  }
}
