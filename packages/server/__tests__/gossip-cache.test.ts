import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createGossipCache } from "../src/gossip-cache.js";
import type { PeerRecord } from "../src/gossip-cache.js";

function makeRecord(name: string, overrides?: Partial<PeerRecord>): PeerRecord {
  return {
    name,
    publicKey: `pk-${name}`,
    noisePublicKey: `npk-${name}`,
    fingerprint: `fp-${name}`,
    serverUrl: `ws://server-${name}`,
    lastSeen: Math.floor(Date.now() / 1000),
    hopCount: 0,
    ...overrides,
  };
}

describe("gossip-cache", () => {
  it("upsert and lookup round-trip", () => {
    const cache = createGossipCache();
    const record = makeRecord("alice");
    expect(cache.upsert(record)).toBe(true);
    expect(cache.lookup("alice")).toEqual(record);
  });

  it("upsert rejects older lastSeen", () => {
    const cache = createGossipCache();
    const now = Math.floor(Date.now() / 1000);
    cache.upsert(makeRecord("alice", { lastSeen: now }));
    expect(cache.upsert(makeRecord("alice", { lastSeen: now - 10 }))).toBe(false);
    // Original still there
    expect(cache.lookup("alice")?.lastSeen).toBe(now);
  });

  it("upsert accepts newer lastSeen", () => {
    const cache = createGossipCache();
    const now = Math.floor(Date.now() / 1000);
    cache.upsert(makeRecord("alice", { lastSeen: now }));
    expect(cache.upsert(makeRecord("alice", { lastSeen: now + 10 }))).toBe(true);
    expect(cache.lookup("alice")?.lastSeen).toBe(now + 10);
  });

  it("lookup returns undefined for unknown peer", () => {
    const cache = createGossipCache();
    expect(cache.lookup("unknown")).toBeUndefined();
  });

  it("lookup returns undefined for expired record", () => {
    const cache = createGossipCache(60); // 60 second TTL
    const old = Math.floor(Date.now() / 1000) - 120; // 2 minutes ago
    cache.upsert(makeRecord("alice", { lastSeen: old }));
    expect(cache.lookup("alice")).toBeUndefined();
  });

  it("getAll returns non-expired records", () => {
    const cache = createGossipCache(300);
    const now = Math.floor(Date.now() / 1000);
    cache.upsert(makeRecord("alice", { lastSeen: now }));
    cache.upsert(makeRecord("bob", { lastSeen: now - 600 })); // expired
    const all = cache.getAll();
    expect(all).toHaveLength(1);
    expect(all[0]!.name).toBe("alice");
  });

  it("purgeExpired removes old records", () => {
    const cache = createGossipCache(60);
    const old = Math.floor(Date.now() / 1000) - 120;
    cache.upsert(makeRecord("alice", { lastSeen: old }));
    cache.upsert(makeRecord("bob", { lastSeen: Math.floor(Date.now() / 1000) }));
    const count = cache.purgeExpired();
    expect(count).toBe(1);
    expect(cache.size).toBe(1);
  });

  it("clear removes all records", () => {
    const cache = createGossipCache();
    cache.upsert(makeRecord("alice"));
    cache.upsert(makeRecord("bob"));
    expect(cache.size).toBe(2);
    cache.clear();
    expect(cache.size).toBe(0);
  });
});
