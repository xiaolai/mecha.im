import { type NodeEntry, readNodes, readDiscoveredNodes, createLogger } from "@mecha/core";

const log = createLogger("node-resolve");

/**
 * Find a node entry by name from manual + discovered nodes.
 * Returns null if not found.
 */
export function resolveNodeEntry(mechaDir: string, name: string): NodeEntry | null {
  try {
    const manual = readNodes(mechaDir);
    const found = manual.find((n) => n.name === name);
    if (found) return found;
  /* v8 ignore start -- filesystem errors */
  } catch (err) {
    log.warn("Failed to read nodes.json", { detail: err instanceof Error ? err.message : String(err) });
  }
  /* v8 ignore stop */

  try {
    const discovered = readDiscoveredNodes(mechaDir);
    const found = discovered.find((d) => d.name === name);
    if (found) {
      return {
        name: found.name, host: found.host, port: found.port,
        apiKey: found.apiKey, addedAt: found.addedAt,
        ...(found.fingerprint && { fingerprint: found.fingerprint }),
      };
    }
  /* v8 ignore start -- filesystem errors */
  } catch {
    log.warn("Failed to read discovered nodes");
  }
  /* v8 ignore stop */

  return null;
}
