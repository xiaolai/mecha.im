/** Routing hint from gossip: a peer is online on a remote server. */
export interface PeerRecord {
  name: string;
  publicKey: string;
  noisePublicKey: string;
  fingerprint: string;
  serverUrl: string;
  lastSeen: number;      // Unix timestamp (seconds)
  hopCount: number;       // 0 = locally registered, incremented on forward
}

const DEFAULT_TTL_S = 300; // 5 minutes

/**
 * In-memory peer record cache with TTL.
 * Gossip records are routing hints only — never auto-added to the trust store.
 */
export function createGossipCache(ttlSeconds = DEFAULT_TTL_S) {
  const records = new Map<string, PeerRecord>();

  return {
    /** Insert or update a record. Only accepts if newer lastSeen. */
    upsert(record: PeerRecord): boolean {
      const existing = records.get(record.name);
      if (existing && existing.lastSeen >= record.lastSeen) return false;
      // Clamp future timestamps to prevent poisoned records pinning beyond TTL
      const maxAllowedSkew = 30; // seconds
      const now = Math.floor(Date.now() / 1000);
      const clamped = { ...record, lastSeen: Math.min(record.lastSeen, now + maxAllowedSkew) };
      records.set(clamped.name, clamped);
      return true;
    },

    /** Lookup a peer. Returns undefined if not found or expired. */
    lookup(name: string): PeerRecord | undefined {
      const record = records.get(name);
      if (!record) return undefined;
      const now = Math.floor(Date.now() / 1000);
      if (now - record.lastSeen > ttlSeconds) {
        records.delete(name);
        return undefined;
      }
      return record;
    },

    /** Return all non-expired records. */
    getAll(): PeerRecord[] {
      const now = Math.floor(Date.now() / 1000);
      const result: PeerRecord[] = [];
      for (const [name, record] of records) {
        if (now - record.lastSeen > ttlSeconds) {
          records.delete(name);
        } else {
          result.push(record);
        }
      }
      return result;
    },

    /** Remove expired records. Returns count of purged entries. */
    purgeExpired(): number {
      const now = Math.floor(Date.now() / 1000);
      let count = 0;
      for (const [name, record] of records) {
        if (now - record.lastSeen > ttlSeconds) {
          records.delete(name);
          count++;
        }
      }
      return count;
    },

    /** Number of records currently stored (including potentially expired). */
    get size(): number {
      return records.size;
    },

    /** Clear all records. */
    clear(): void {
      records.clear();
    },
  };
}

export type GossipCache = ReturnType<typeof createGossipCache>;
