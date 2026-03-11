import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { botConfigSchema, type BotConfig } from "../agent/types.js";
import { ConfigValidationError } from "../shared/errors.js";
import { isValidName } from "../shared/validation.js";

export type { BotConfig };

export function loadBotConfig(filePath: string): BotConfig {
  const raw = readFileSync(filePath, "utf-8");
  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (err) {
    throw new ConfigValidationError(`YAML parse error: ${err instanceof Error ? err.message : String(err)}`);
  }
  const result = botConfigSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new ConfigValidationError(issues);
  }
  return validateConfig(result.data);
}

export function buildInlineConfig(opts: {
  name: string;
  system: string;
  model?: string;
}): BotConfig {
  const result = botConfigSchema.safeParse({
    name: opts.name,
    system: opts.system,
    model: opts.model ?? "sonnet",
  });
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new ConfigValidationError(issues);
  }
  return validateConfig(result.data);
}

function validateConfig(config: BotConfig): BotConfig {
  if (!isValidName(config.name)) {
    throw new ConfigValidationError(
      `name "${config.name}" must be lowercase alphanumeric + hyphens, 1-32 chars`,
    );
  }

  if (config.tailscale) {
    if (config.tailscale.auth_key && config.tailscale.auth_key_profile) {
      throw new ConfigValidationError(
        "tailscale.auth_key and tailscale.auth_key_profile are mutually exclusive",
      );
    }
  }

  return config;
}
