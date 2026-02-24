import { createConnection } from "node:net";
import { DEFAULTS } from "@mecha/core";
import { PortConflictError } from "@mecha/contracts";

/**
 * Check if a port is available by attempting a TCP connection.
 * Returns true if the port is free (connection refused), false if in use.
 */
export function checkPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: "127.0.0.1" });
    socket.once("connect", () => {
      socket.destroy();
      resolve(false); // port is in use
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(true); // port is free
    });
  });
}

/**
 * Allocate the first available port in [base, max] range,
 * skipping ports in the exclude set.
 * Throws PortConflictError if no port is available.
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
  // Use base port as the representative — all ports in range are in use
  throw new PortConflictError(base);
}
