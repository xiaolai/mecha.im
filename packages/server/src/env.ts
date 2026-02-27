import { DEFAULT_CONFIG } from "./types.js";

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
  const port = parseInt(rawPort, 10);
  if (Number.isNaN(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid PORT: "${rawPort}" (must be 0-65535)`);
  }

  const host = env.HOST ?? DEFAULT_CONFIG.host;
  const relayUrl = env.RELAY_URL ?? DEFAULT_CONFIG.relayUrl;

  return { port, host, relayUrl };
}
