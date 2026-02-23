import type { ProcessManager } from "@mecha/process";
import type { MechaRef } from "@mecha/core";
import { MechaNotLocatedError, NodeUnreachableError } from "@mecha/contracts";
import { mechaLs } from "./inspect.js";
import { agentFetch } from "./agent-client.js";
import type { NodeEntry } from "./agent-client.js";

export interface LocatorOptions {
  /** TTL for cache entries in ms. Default: 30_000 (30s). */
  cacheTtlMs?: number;
}

interface CacheEntry {
  ref: MechaRef & { entry?: NodeEntry };
  expiresAt: number;
}

export class MechaLocator {
  private cache = new Map<string, CacheEntry>();
  private ttl: number;

  constructor(opts: LocatorOptions = {}) {
    this.ttl = opts.cacheTtlMs ?? 30_000;
  }

  /** Resolve a mecha ID to a MechaRef + connection info. */
  async locate(
    pm: ProcessManager,
    mechaId: string,
    nodes: NodeEntry[],
  ): Promise<MechaRef & { entry?: NodeEntry }> {
    // 1. Check cache
    const cached = this.cache.get(mechaId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.ref;
    }

    // 2. Check local processes
    const locals = await mechaLs(pm);
    if (locals.some((m) => m.id === mechaId)) {
      const ref: MechaRef & { entry?: NodeEntry } = { node: "local", id: mechaId };
      this.cache.set(mechaId, { ref, expiresAt: Date.now() + this.ttl });
      return ref;
    }

    // 3. Query each remote node
    for (const entry of nodes) {
      try {
        const res = await agentFetch(entry, "/mechas");
        const mechas = (await res.json()) as Array<{ id: string }>;
        if (mechas.some((m) => m.id === mechaId)) {
          const ref: MechaRef & { entry?: NodeEntry } = { node: entry.name, id: mechaId, entry };
          this.cache.set(mechaId, { ref, expiresAt: Date.now() + this.ttl });
          return ref;
        }
      } catch (err) {
        // Skip unreachable nodes but surface auth/request errors
        if (err instanceof NodeUnreachableError) continue;
        throw err;
      }
    }

    throw new MechaNotLocatedError(mechaId);
  }

  /** Invalidate a specific mecha from cache. */
  invalidate(mechaId: string): void {
    this.cache.delete(mechaId);
  }

  /** Clear all cache entries. */
  clear(): void {
    this.cache.clear();
  }
}
