import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  readDiscoveredNodes,
  writeDiscoveredNode,
  removeDiscoveredNode,
  cleanupExpiredNodes,
  refreshDiscoveredNodes,
  promoteDiscoveredNode,
} from "../src/discovered-registry.js";
import type { DiscoveredNode } from "../src/discovered-registry.js";
import { addNode } from "../src/node-registry.js";

function makeNode(overrides: Partial<DiscoveredNode> = {}): DiscoveredNode {
  return {
    name: "test-node",
    host: "100.100.1.5",
    port: 7660,
    apiKey: "mesh-key-123",
    source: "tailscale",
    lastSeen: new Date().toISOString(),
    addedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("discovered-registry", () => {
  let mechaDir: string;

  beforeEach(() => { mechaDir = mkdtempSync(join(tmpdir(), "mecha-disc-")); });
  afterEach(() => { rmSync(mechaDir, { recursive: true, force: true }); });

  it("returns empty array when no file exists", () => {
    expect(readDiscoveredNodes(mechaDir)).toEqual([]);
  });

  it("writes and reads a discovered node", () => {
    const node = makeNode();
    writeDiscoveredNode(mechaDir, node);
    const nodes = readDiscoveredNodes(mechaDir);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.name).toBe("test-node");
  });

  it("updates lastSeen for existing node", () => {
    const node = makeNode({ lastSeen: "2020-01-01T00:00:00Z" });
    writeDiscoveredNode(mechaDir, node);
    const updated = makeNode({ lastSeen: "2026-03-05T12:00:00Z" });
    writeDiscoveredNode(mechaDir, updated);
    const nodes = readDiscoveredNodes(mechaDir);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.lastSeen).toBe("2026-03-05T12:00:00Z");
  });

  it("removes a discovered node", () => {
    writeDiscoveredNode(mechaDir, makeNode({ name: "a" }));
    writeDiscoveredNode(mechaDir, makeNode({ name: "b" }));
    const removed = removeDiscoveredNode(mechaDir, "a");
    expect(removed).toBe(true);
    expect(readDiscoveredNodes(mechaDir)).toHaveLength(1);
  });

  it("returns false when removing non-existent node", () => {
    expect(removeDiscoveredNode(mechaDir, "ghost")).toBe(false);
  });

  it("cleans up nodes older than TTL", () => {
    const old = makeNode({
      name: "stale",
      lastSeen: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    });
    const recent = makeNode({ name: "fresh" });
    writeDiscoveredNode(mechaDir, old);
    writeDiscoveredNode(mechaDir, recent);
    const removed = cleanupExpiredNodes(mechaDir, 60 * 60 * 1000); // 1 hour
    expect(removed).toEqual(["stale"]);
    expect(readDiscoveredNodes(mechaDir)).toHaveLength(1);
  });

  it("promotes a discovered node to manual registry", () => {
    writeDiscoveredNode(mechaDir, makeNode({ name: "peer1", apiKey: "key1" }));
    const entry = promoteDiscoveredNode(mechaDir, "peer1");
    expect(entry).toBeDefined();
    expect(entry!.name).toBe("peer1");
    // Removed from discovered
    expect(readDiscoveredNodes(mechaDir)).toHaveLength(0);
  });

  it("returns undefined when promoting non-existent node", () => {
    const entry = promoteDiscoveredNode(mechaDir, "ghost");
    expect(entry).toBeUndefined();
  });

  it("promotes without duplicating if already in manual registry", () => {
    addNode(mechaDir, {
      name: "peer1",
      host: "100.100.1.5",
      port: 7660,
      apiKey: "existing-key",
      addedAt: new Date().toISOString(),
    });
    writeDiscoveredNode(mechaDir, makeNode({ name: "peer1", apiKey: "key1" }));
    const entry = promoteDiscoveredNode(mechaDir, "peer1");
    expect(entry).toBeDefined();
    expect(entry!.name).toBe("peer1");
    expect(readDiscoveredNodes(mechaDir)).toHaveLength(0);
  });

  it("refreshDiscoveredNodes updates lastSeen for matching hosts", () => {
    writeDiscoveredNode(mechaDir, makeNode({ name: "a", host: "100.100.1.5" }));
    writeDiscoveredNode(mechaDir, makeNode({ name: "b", host: "100.100.1.6" }));
    writeDiscoveredNode(mechaDir, makeNode({ name: "c", host: "100.100.1.7" }));
    const newTime = "2026-06-01T00:00:00Z";
    const updated = refreshDiscoveredNodes(mechaDir, new Set(["100.100.1.5", "100.100.1.7"]), newTime);
    expect(updated).toBe(2);
    const nodes = readDiscoveredNodes(mechaDir);
    const a = nodes.find((n) => n.name === "a")!;
    const b = nodes.find((n) => n.name === "b")!;
    const c = nodes.find((n) => n.name === "c")!;
    expect(a.lastSeen).toBe(newTime);
    expect(b.lastSeen).not.toBe(newTime);
    expect(c.lastSeen).toBe(newTime);
  });

  it("refreshDiscoveredNodes returns 0 when no hosts match", () => {
    writeDiscoveredNode(mechaDir, makeNode({ name: "a", host: "100.100.1.5" }));
    const updated = refreshDiscoveredNodes(mechaDir, new Set(["99.99.99.99"]), new Date().toISOString());
    expect(updated).toBe(0);
  });

  it("cleanupExpiredNodes returns empty when no nodes are expired", () => {
    writeDiscoveredNode(mechaDir, makeNode({ name: "fresh" }));
    const removed = cleanupExpiredNodes(mechaDir, 60 * 60 * 1000);
    expect(removed).toEqual([]);
    expect(readDiscoveredNodes(mechaDir)).toHaveLength(1);
  });

  it("preserves addedAt when updating existing discovered node", () => {
    const originalAddedAt = "2025-01-01T00:00:00Z";
    writeDiscoveredNode(mechaDir, makeNode({ name: "a", addedAt: originalAddedAt }));
    writeDiscoveredNode(mechaDir, makeNode({ name: "a", addedAt: "2026-01-01T00:00:00Z", lastSeen: "2026-06-01T00:00:00Z" }));
    const nodes = readDiscoveredNodes(mechaDir);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.addedAt).toBe(originalAddedAt);
  });
});
