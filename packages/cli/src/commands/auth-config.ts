import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { readAuthConfig, writeAuthConfig } from "@mecha/core";
import { withErrorHandler } from "../error-handler.js";

interface AuthConfigOpts {
  totp?: boolean;
  apiKey?: boolean;
}

export function executeAuthConfig(opts: AuthConfigOpts, deps: CommandDeps): void {
  const hasFlags = opts.totp !== undefined || opts.apiKey !== undefined;

  if (!hasFlags) {
    // Show current config
    const config = readAuthConfig(deps.mechaDir);
    if (deps.formatter.isJson) {
      deps.formatter.json(config);
    } else {
      deps.formatter.info(`TOTP:    ${config.totp ? "enabled" : "disabled"}`);
      deps.formatter.info(`API key: ${config.apiKey ? "enabled" : "disabled"}`);
    }
    return;
  }

  // Update config
  const current = readAuthConfig(deps.mechaDir);
  const updated = {
    totp: opts.totp !== undefined ? opts.totp : current.totp,
    apiKey: opts.apiKey !== undefined ? opts.apiKey : current.apiKey,
  };

  writeAuthConfig(deps.mechaDir, updated);
  /* v8 ignore start -- JSON output branch for machine-readable consumers */
  if (deps.formatter.isJson) {
    deps.formatter.json(updated);
  } else {
  /* v8 ignore stop */
    deps.formatter.success("Auth config updated");
    deps.formatter.info(`TOTP:    ${updated.totp ? "enabled" : "disabled"}`);
    deps.formatter.info(`API key: ${updated.apiKey ? "enabled" : "disabled"}`);
  }
}

/* v8 ignore start -- commander wiring tested via executeAuthConfig */
export function registerAuthConfigCommand(program: Command, deps: CommandDeps): void {
  program
    .command("auth-config")
    .description("View or update authentication configuration")
    .option("--totp", "Enable TOTP authentication")
    .option("--no-totp", "Disable TOTP authentication")
    .option("--api-key", "Enable API key authentication")
    .option("--no-api-key", "Disable API key authentication")
    .action(async (opts: AuthConfigOpts) => withErrorHandler(deps, async () => executeAuthConfig(opts, deps)));
}
/* v8 ignore stop */
