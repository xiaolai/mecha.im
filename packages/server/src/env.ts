import { DEFAULT_CONFIG } from "./types.js";

/** Validated server environment configuration. */
export interface ServerEnv {
  port: number;
  host: string;
  relayUrl: string;
}

/**
 * Parse and validate server environment variables.
 * Throws descriptive errors for invalid values.
 */
export function parseServerEnv(env: Record<string, string | undefined>): ServerEnv {
  const rawPort = env.PORT ?? String(DEFAULT_CONFIG.port);
  if (!/^\d+$/.test(rawPort)) {
    throw new Error(`Invalid PORT: "${rawPort}" (must be a decimal integer 0-65535)`);
  }
  const port = Number(rawPort);
  if (port < 0 || port > 65535) {
    throw new Error(`Invalid PORT: "${rawPort}" (must be 0-65535)`);
  }

  const host = env.HOST ?? DEFAULT_CONFIG.host;
  const relayUrl = env.RELAY_URL ?? DEFAULT_CONFIG.relayUrl;

  return { port, host, relayUrl };
}
