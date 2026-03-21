import { createCircuitBreaker, CircuitOpenError } from "./circuit-breaker.js";
import type { CircuitBreaker } from "./types.js";

/** Error thrown when a request URL host is not in the allowlist. */
export class GatewayDeniedError extends Error {
  constructor(host: string) {
    super(`Host not allowed: ${host}`);
    this.name = "GatewayDeniedError";
  }
}

/** Supported HTTP methods. */
export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

/** Options for creating an HTTP gateway. */
export interface HttpGatewayOpts {
  /** URL host patterns to allow (e.g. "api.example.com", "*.example.com"). */
  allowedHosts: string[];
  /** Circuit breaker options per host. */
  maxFailures?: number;
  resetTimeoutMs?: number;
}

/** Options for executing an HTTP request through the gateway. */
export interface HttpRequestOpts {
  method?: HttpMethod;
  headers?: Record<string, string>;
  body?: string;
}

/** Result of an HTTP request. */
export interface HttpRequestResult {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/** An HTTP gateway that enforces host allowlists and circuit breakers. */
export interface HttpGateway {
  /** Execute an HTTP request, enforcing the allowlist and circuit breaker. */
  executeRequest(url: string, opts?: HttpRequestOpts): Promise<HttpRequestResult>;
}

/**
 * Check if a host matches an allowed pattern.
 * Supports exact match and wildcard prefix (e.g. "*.example.com").
 */
function matchesHost(host: string, pattern: string): boolean {
  if (pattern === host) return true;
  if (pattern.startsWith("*.")) {
    const suffix = pattern.slice(1); // ".example.com"
    return host.endsWith(suffix) && host.length > suffix.length;
  }
  return false;
}

/**
 * Create an HTTP gateway with host allowlist and per-host circuit breakers.
 */
export function createHttpGateway(opts: HttpGatewayOpts): HttpGateway {
  const { allowedHosts, maxFailures, resetTimeoutMs } = opts;
  const breakers = new Map<string, CircuitBreaker>();

  function getBreaker(host: string): CircuitBreaker {
    let cb = breakers.get(host);
    if (!cb) {
      cb = createCircuitBreaker({ maxFailures, resetTimeoutMs });
      breakers.set(host, cb);
    }
    return cb;
  }

  function isAllowed(host: string): boolean {
    return allowedHosts.some((pattern) => matchesHost(host, pattern));
  }

  return {
    async executeRequest(url: string, reqOpts?: HttpRequestOpts): Promise<HttpRequestResult> {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        throw new GatewayDeniedError(url);
      }

      const host = parsed.hostname;
      if (!isAllowed(host)) {
        throw new GatewayDeniedError(host);
      }

      const method = reqOpts?.method ?? "GET";
      const cb = getBreaker(host);

      return cb.execute(async () => {
        const fetchOpts: RequestInit = {
          method,
          headers: reqOpts?.headers,
        };
        if (reqOpts?.body && method !== "GET") {
          fetchOpts.body = reqOpts.body;
        }

        fetchOpts.redirect = "manual";
        const resp = await fetch(url, fetchOpts);
        const body = await resp.text();

        const headers: Record<string, string> = {};
        resp.headers.forEach((value, key) => {
          headers[key] = value;
        });

        return { status: resp.status, headers, body };
      });
    },
  };
}

export { CircuitOpenError };
