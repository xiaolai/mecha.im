import { PluginEnvError } from "./plugin-registry.js";

/**
 * Resolve `${VAR}` and `${VAR:-default}` placeholders in a record of strings.
 * Reads from `process.env` (host environment).
 *
 * @throws PluginEnvError if a variable is unresolved with no default
 */
export function resolveEnvVars(vars: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(vars)) {
    result[key] = resolveEnvString(value);
  }
  return result;
}

/**
 * Resolve `${VAR}` and `${VAR:-default}` in a single string value.
 *
 * @throws PluginEnvError if a variable is unresolved with no default
 */
export function resolveEnvString(value: string): string {
  return value.replace(/\$\{(\w+)(?::-([^}]*))?\}/g, (match, name: string, fallback: string | undefined) => {
    const resolved = process.env[name];
    if (resolved !== undefined) return resolved;
    if (fallback !== undefined) return fallback;
    throw new PluginEnvError(`Unresolved environment variable: \${${name}}`);
  });
}
