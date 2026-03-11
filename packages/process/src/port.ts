import { createConnection, createServer } from "node:net";
import { DEFAULTS, PortRangeExhaustedError } from "@mecha/core";

/**
 * Check if a port is available by attempting a TCP connection.
 * Returns true if the port is free (connection refused), false if in use.
 */
export function checkPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: "127.0.0.1" });
    socket.setTimeout(DEFAULTS.PORT_CHECK_TIMEOUT_MS);
    socket.once("connect", () => {
      socket.destroy();
      resolve(false); // port is in use
    });
    socket.once("error", (err: NodeJS.ErrnoException) => {
      socket.destroy();
      // Only ECONNREFUSED reliably means "port is free"
      resolve(err.code === "ECONNREFUSED");
    });
    /* v8 ignore start -- timeout only fires on real network delay */
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false); // timeout — treat as in use / unreachable
    });
    /* v8 ignore stop */
  });
}

/**
 * Atomically claim a port by binding a temporary TCP server.
 * Returns a release function that closes the server to free the port.
 * Returns undefined if the port is already in use.
 *
 * This eliminates the TOCTOU race in checkPort() — the OS guarantees
 * that bind() is atomic, so concurrent processes cannot claim the same port.
 */
export function claimPort(port: number): Promise<(() => Promise<void>) | undefined> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(undefined));
    server.listen(port, "127.0.0.1", () => {
      let released = false;
      resolve(() => {
        if (released) return Promise.resolve();
        released = true;
        return new Promise<void>((res) => {
          server.close(() => res());
        });
      });
    });
  });
}

/**
 * Allocate the first available port in [base, max] range,
 * skipping ports in the exclude set.
 * Throws PortRangeExhaustedError if no port is available.
 *
 * Uses atomic bind via claimPort() to prevent cross-process races.
 * The returned PortClaim holds the port until release() is called,
 * preventing concurrent spawns from claiming the same port.
 */
export async function allocatePort(
  base: number = DEFAULTS.RUNTIME_PORT_BASE,
  max: number = DEFAULTS.RUNTIME_PORT_MAX,
  exclude: Set<number> = new Set(),
): Promise<PortClaim> {
  for (let port = base; port <= max; port++) {
    if (exclude.has(port)) continue;
    const release = await claimPort(port);
    if (release) return { port, release };
  }
  throw new PortRangeExhaustedError(base, max);
}

/** A claimed port with a release function to free it. */
export interface PortClaim {
  port: number;
  /** Close the temporary server to free the port for the actual bot process. Idempotent. */
  release: () => Promise<void>;
}
