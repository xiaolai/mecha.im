const DEFAULT_READ_LIMIT = { max: 120, windowMs: 60_000 };
const DEFAULT_QUERY_LIMIT = { max: 30, windowMs: 60_000 };

export interface RateLimitConfig {
  max: number;
  windowMs: number;
}

export interface RateLimiter {
  check(tool: string): boolean;
  remaining(tool: string): number;
}

function getDefaultConfig(tool: string): RateLimitConfig {
  if (tool === "mecha_query") return DEFAULT_QUERY_LIMIT;
  return DEFAULT_READ_LIMIT;
}

export function createRateLimiter(
  limits?: Record<string, RateLimitConfig>,
): RateLimiter {
  const windows = new Map<string, number[]>();

  function getConfig(tool: string): RateLimitConfig {
    return limits?.[tool] ?? getDefaultConfig(tool);
  }

  function prune(tool: string): number[] {
    const config = getConfig(tool);
    const now = Date.now();
    const cutoff = now - config.windowMs;
    const timestamps = windows.get(tool) ?? [];
    const active = timestamps.filter((ts) => ts > cutoff);
    windows.set(tool, active);
    return active;
  }

  return {
    check(tool: string): boolean {
      const active = prune(tool);
      const config = getConfig(tool);
      if (active.length >= config.max) return false;
      active.push(Date.now());
      return true;
    },

    remaining(tool: string): number {
      const active = prune(tool);
      const config = getConfig(tool);
      return Math.max(0, config.max - active.length);
    },
  };
}
