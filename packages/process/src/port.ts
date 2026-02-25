import { createConnection } from "node:net";
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
 * Allocate the first available port in [base, max] range,
 * skipping ports in the exclude set.
 * Throws PortRangeExhaustedError if no port is available.
 */
export async function allocatePort(
  base: number = DEFAULTS.RUNTIME_PORT_BASE,
  max: number = DEFAULTS.RUNTIME_PORT_MAX,
  exclude: Set<number> = new Set(),
): Promise<number> {
  for (let port = base; port <= max; port++) {
    if (exclude.has(port)) continue;
    const free = await checkPort(port);
    if (free) return port;
  }
  throw new PortRangeExhaustedError(base, max);
}
