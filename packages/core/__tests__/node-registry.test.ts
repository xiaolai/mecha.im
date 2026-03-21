import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readNodes, addNode, removeNode, getNode, writeNodes } from "../src/node-registry.js";
import type { NodeEntry } from "../src/node-registry.js";

describe("node-registry", () => {
  let mechaDir: string;

  beforeEach(() => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-nodes-"));
  });
  afterEach(() => { rmSync(mechaDir, { recursive: true, force: true }); });

  function makeEntry(name: string): NodeEntry {
    return { name, host: "192.168.1.10", port: 7660, apiKey: "key-" + name, addedAt: new Date().toISOString() };
  }

  describe("readNodes", () => {
    it("returns empty array when no file", () => {
      expect(readNodes(mechaDir)).toEqual([]);
    });

    it("reads existing nodes", () => {
      const nodes = [makeEntry("alice")];
      writeNodes(mechaDir, nodes);
      expect(readNodes(mechaDir)).toEqual(nodes);
    });
  });

  describe("addNode", () => {
    it("adds a node to empty registry", () => {
      const entry = makeEntry("alice");
      addNode(mechaDir, entry);
      expect(readNodes(mechaDir)).toEqual([entry]);
    });

    it("appends to existing nodes", () => {
      addNode(mechaDir, makeEntry("alice"));
      addNode(mechaDir, makeEntry("bob"));
      expect(readNodes(mechaDir)).toHaveLength(2);
    });

    it("throws DuplicateNodeError on duplicate name", () => {
      addNode(mechaDir, makeEntry("alice"));
      expect(() => addNode(mechaDir, makeEntry("alice"))).toThrow(/already registered/);
    });

    it("throws InvalidNameError for invalid name", () => {
      expect(() => addNode(mechaDir, makeEntry("BAD"))).toThrow(/Invalid name/);
    });
  });

  describe("removeNode", () => {
    it("removes existing node and returns true", () => {
      addNode(mechaDir, makeEntry("alice"));
      addNode(mechaDir, makeEntry("bob"));
      expect(removeNode(mechaDir, "alice")).toBe(true);
      expect(readNodes(mechaDir)).toHaveLength(1);
      expect(readNodes(mechaDir)[0].name).toBe("bob");
    });

    it("returns false when node not found", () => {
      expect(removeNode(mechaDir, "ghost")).toBe(false);
    });

    it("throws InvalidNameError for invalid name", () => {
      expect(() => removeNode(mechaDir, "BAD")).toThrow(/Invalid name/);
    });
  });

  describe("getNode", () => {
    it("returns node by name", () => {
      const entry = makeEntry("alice");
      addNode(mechaDir, entry);
      expect(getNode(mechaDir, "alice")).toEqual(entry);
    });

    it("returns undefined when not found", () => {
      expect(getNode(mechaDir, "ghost")).toBeUndefined();
    });

    it("throws InvalidNameError for invalid name", () => {
      expect(() => getNode(mechaDir, "BAD")).toThrow(/Invalid name/);
    });
  });

  describe("writeNodes", () => {
    it("overwrites existing data", () => {
      addNode(mechaDir, makeEntry("alice"));
      writeNodes(mechaDir, [makeEntry("bob")]);
      const nodes = readNodes(mechaDir);
      expect(nodes).toHaveLength(1);
      expect(nodes[0].name).toBe("bob");
    });
  });

  describe("managed node entries (Phase 6)", () => {
    function makeManagedEntry(name: string): NodeEntry {
      return {
        name,
        host: "",
        port: 0,
        apiKey: "",
        publicKey: "-----BEGIN PUBLIC KEY-----\nMC...\n-----END PUBLIC KEY-----",
        noisePublicKey: "base64-x25519-pubkey",
        fingerprint: "abcdef1234567890",
        addedAt: new Date().toISOString(),
        managed: true,
      };
    }

    it("adds and reads a managed node", () => {
      const entry = makeManagedEntry("bob");
      addNode(mechaDir, entry);
      const nodes = readNodes(mechaDir);
      expect(nodes).toHaveLength(1);
      expect(nodes[0]!.managed).toBe(true);
      expect(nodes[0]!.noisePublicKey).toBe("base64-x25519-pubkey");
      expect(nodes[0]!.fingerprint).toBe("abcdef1234567890");
    });

    it("coexists with http-mode nodes", () => {
      addNode(mechaDir, makeEntry("alice"));
      addNode(mechaDir, makeManagedEntry("bob"));
      const nodes = readNodes(mechaDir);
      expect(nodes).toHaveLength(2);
      expect(nodes[0]!.managed).toBeUndefined();
      expect(nodes[1]!.managed).toBe(true);
    });

    it("retrieves managed node by name", () => {
      addNode(mechaDir, makeManagedEntry("bob"));
      const node = getNode(mechaDir, "bob");
      expect(node).toBeDefined();
      expect(node!.managed).toBe(true);
    });
  });
});
