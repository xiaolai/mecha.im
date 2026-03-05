import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  readDiscoveredNodes,
  writeDiscoveredNode,
  removeDiscoveredNode,
  cleanupExpiredNodes,
  promoteDiscoveredNode,
  type DiscoveredNode,
} from "@mecha/core";

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
});
