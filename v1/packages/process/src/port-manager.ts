import { createServer } from "node:net";
import type { MechaProcessInfo } from "./types.js";

/**
 * Check if a port is available by attempting to bind to it.
 * Returns true if the port is free.
 */
export function checkPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.unref();
    server.on("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
}

/**
 * Allocate a port from the range [portBase, portMax].
 *
 * If `preferred` is specified and available, returns it.
 * Otherwise scans the range, skipping ports already allocated to live processes.
 */
export async function allocatePort(
  portBase: number,
  portMax: number,
  allocated: MechaProcessInfo[],
  preferred?: number,
): Promise<number> {
  // Try preferred port first
  if (preferred !== undefined) {
    if (preferred < 1024 || preferred > 65535) {
      throw new Error(`Port ${preferred} is out of valid range (1024-65535)`);
    }
    const available = await checkPort(preferred);
    if (available) return preferred;
    throw new Error(`Preferred port ${preferred} is not available`);
  }

  // Collect ports already in use by live processes
  const usedPorts = new Set(allocated.map((p) => p.port));

  for (let port = portBase; port <= portMax; port++) {
    if (usedPorts.has(port)) continue;
    const available = await checkPort(port);
    if (available) return port;
  }

  throw new Error(`No available ports in range ${portBase}-${portMax}`);
}
