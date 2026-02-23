import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Mock os.homedir and core constants BEFORE importing the module
const testDir = mkdtempSync(join(tmpdir(), "node-reg-"));
vi.mock("node:os", async (importOriginal) => {
  const orig = await importOriginal<typeof import("node:os")>();
  return { ...orig, homedir: () => testDir };
});

vi.mock("@mecha/core", () => ({
  DEFAULTS: { HOME_DIR: ".mecha" },
}));

const { readNodes, readNodesAsync, writeNodes, addNode, removeNode } = await import("../src/node-registry.js");

describe("node-registry", () => {
  const mechaDir = join(testDir, ".mecha");

  beforeEach(() => {
    // Ensure clean state
    try { rmSync(join(mechaDir, "nodes.json")); } catch { /* ignore */ }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("readNodes", () => {
    it("returns empty array when file does not exist", () => {
      expect(readNodes()).toEqual([]);
    });

    it("returns empty array when file contains non-array JSON", () => {
      mkdirSync(mechaDir, { recursive: true });
      writeFileSync(join(mechaDir, "nodes.json"), '"not-an-array"');
      expect(readNodes()).toEqual([]);
    });

    it("throws on invalid JSON (corrupted file)", () => {
      mkdirSync(mechaDir, { recursive: true });
      writeFileSync(join(mechaDir, "nodes.json"), "{broken");
      expect(() => readNodes()).toThrow();
    });

    it("reads existing nodes from file", () => {
      mkdirSync(mechaDir, { recursive: true });
      const data = [{ name: "a", host: "1.2.3.4:7660", key: "k1" }];
      writeFileSync(join(mechaDir, "nodes.json"), JSON.stringify(data));
      expect(readNodes()).toEqual(data);
    });

    it("filters out entries with missing or invalid fields", () => {
      mkdirSync(mechaDir, { recursive: true });
      const data = [
        { name: "valid", host: "1.2.3.4:7660", key: "k1" },
        { name: 123, host: "bad", key: "k2" },
        { name: "no-key", host: "5.6.7.8:7660" },
        null,
        "not-an-object",
      ];
      writeFileSync(join(mechaDir, "nodes.json"), JSON.stringify(data));
      expect(readNodes()).toEqual([{ name: "valid", host: "1.2.3.4:7660", key: "k1" }]);
    });
  });

  describe("readNodesAsync", () => {
    it("returns empty array when file does not exist", async () => {
      expect(await readNodesAsync()).toEqual([]);
    });

    it("returns empty array when file contains non-array JSON", async () => {
      mkdirSync(mechaDir, { recursive: true });
      writeFileSync(join(mechaDir, "nodes.json"), '"not-an-array"');
      expect(await readNodesAsync()).toEqual([]);
    });

    it("throws on invalid JSON (corrupted file)", async () => {
      mkdirSync(mechaDir, { recursive: true });
      writeFileSync(join(mechaDir, "nodes.json"), "{broken");
      await expect(readNodesAsync()).rejects.toThrow();
    });

    it("reads existing nodes from file", async () => {
      mkdirSync(mechaDir, { recursive: true });
      const data = [{ name: "a", host: "1.2.3.4:7660", key: "k1" }];
      writeFileSync(join(mechaDir, "nodes.json"), JSON.stringify(data));
      expect(await readNodesAsync()).toEqual(data);
    });

    it("filters out entries with missing or invalid fields", async () => {
      mkdirSync(mechaDir, { recursive: true });
      const data = [
        { name: "valid", host: "1.2.3.4:7660", key: "k1" },
        { name: 123, host: "bad", key: "k2" },
        null,
      ];
      writeFileSync(join(mechaDir, "nodes.json"), JSON.stringify(data));
      expect(await readNodesAsync()).toEqual([{ name: "valid", host: "1.2.3.4:7660", key: "k1" }]);
    });
  });

  describe("writeNodes", () => {
    it("creates directory and writes nodes file", () => {
      const nodes = [{ name: "b", host: "5.6.7.8:7660", key: "k2" }];
      writeNodes(nodes);
      const raw = readFileSync(join(mechaDir, "nodes.json"), "utf-8");
      expect(JSON.parse(raw)).toEqual(nodes);
    });
  });

  describe("addNode", () => {
    it("adds a node and persists it", () => {
      const entry = addNode("test-node", "10.0.0.1:7660", "secret");
      expect(entry).toEqual({ name: "test-node", host: "10.0.0.1:7660", key: "secret" });
      expect(readNodes()).toContainEqual(entry);
    });

    it("throws when adding a duplicate name", () => {
      addNode("dup", "1.1.1.1:7660", "k1");
      expect(() => addNode("dup", "2.2.2.2:7660", "k2")).toThrow('Node "dup" already exists');
    });
  });

  describe("removeNode", () => {
    it("removes an existing node", () => {
      addNode("rm-test", "3.3.3.3:7660", "k3");
      removeNode("rm-test");
      expect(readNodes()).toEqual([]);
    });

    it("throws when removing a non-existent node", () => {
      expect(() => removeNode("ghost")).toThrow('Node "ghost" not found');
    });
  });
});
