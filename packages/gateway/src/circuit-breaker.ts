import type { CircuitBreaker, CircuitBreakerOpts, CircuitState } from "./types.js";

/** Error thrown when the circuit breaker is open and rejecting calls. */
export class CircuitOpenError extends Error {
  constructor() {
    super("Circuit breaker is open");
    this.name = "CircuitOpenError";
  }
}

/**
 * Create a simple circuit breaker.
 * Tracks consecutive failures and trips after maxFailures.
 * Auto-resets to half-open after resetTimeoutMs, allowing one test call.
 */
export function createCircuitBreaker(opts: CircuitBreakerOpts = {}): CircuitBreaker {
  const maxFailures = opts.maxFailures ?? 5;
  const resetTimeoutMs = opts.resetTimeoutMs ?? 60_000;

  let state: CircuitState = "closed";
  let failureCount = 0;
  let lastFailureTime = 0;

  return {
    get state() {
      // Check if open circuit should transition to half-open
      if (state === "open" && Date.now() - lastFailureTime >= resetTimeoutMs) {
        state = "half-open";
      }
      return state;
    },

    async execute<T>(fn: () => Promise<T>): Promise<T> {
      // Re-evaluate state (may transition open → half-open)
      /* v8 ignore start -- open→half-open transition requires real timeout */
      if (state === "open" && Date.now() - lastFailureTime >= resetTimeoutMs) {
        state = "half-open";
      }
      /* v8 ignore stop */

      if (state === "open") {
        throw new CircuitOpenError();
      }

      try {
        const result = await fn();
        // Success: reset to closed
        if (state === "half-open") {
          state = "closed";
          failureCount = 0;
        }
        if (state === "closed") {
          failureCount = 0;
        }
        return result;
      } catch (err) {
        failureCount++;
        lastFailureTime = Date.now();

        if (state === "half-open") {
          // Failed during test call, go back to open
          state = "open";
        } else if (failureCount >= maxFailures) {
          state = "open";
        }

        throw err;
      }
    },

    reset() {
      state = "closed";
      failureCount = 0;
      lastFailureTime = 0;
    },
  };
}
