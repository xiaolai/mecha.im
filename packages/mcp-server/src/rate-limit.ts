const DEFAULT_READ_LIMIT = { max: 120, windowMs: 60_000 };
const DEFAULT_QUERY_LIMIT = { max: 30, windowMs: 60_000 };

/** Per-tool rate limit configuration. */
export interface RateLimitConfig {
  max: number;
  windowMs: number;
}

/**
 * Sliding-window rate limiter for MCP tool calls.
 *
 * Supports optional per-client isolation via the `clientId` parameter.
 * When `clientId` is provided, each client gets its own rate limit window;
 * otherwise all callers share a single global window per tool.
 */
export interface RateLimiter {
  check(tool: string, clientId?: string): boolean;
  remaining(tool: string, clientId?: string): number;
}

function getDefaultConfig(tool: string): RateLimitConfig {
  if (tool === "mecha_query") return DEFAULT_QUERY_LIMIT;
  return DEFAULT_READ_LIMIT;
}

/** Create an in-memory sliding-window rate limiter with per-tool limits. */
export function createRateLimiter(
  limits?: Record<string, RateLimitConfig>,
): RateLimiter {
  const windows = new Map<string, number[]>();

  function getConfig(tool: string): RateLimitConfig {
    return limits?.[tool] ?? getDefaultConfig(tool);
  }

  /** Build a composite key for per-client isolation. */
  function windowKey(tool: string, clientId?: string): string {
    return clientId ? `${clientId}:${tool}` : tool;
  }

  function prune(tool: string, clientId?: string): number[] {
    const key = windowKey(tool, clientId);
    const config = getConfig(tool);
    const now = Date.now();
    const cutoff = now - config.windowMs;
    const timestamps = windows.get(key) ?? [];
    const active = timestamps.filter((ts) => ts > cutoff);
    windows.set(key, active);
    return active;
  }

  return {
    check(tool: string, clientId?: string): boolean {
      const active = prune(tool, clientId);
      const config = getConfig(tool);
      if (active.length >= config.max) return false;
      active.push(Date.now());
      return true;
    },

    remaining(tool: string, clientId?: string): number {
      const active = prune(tool, clientId);
      const config = getConfig(tool);
      return Math.max(0, config.max - active.length);
    },
  };
}
