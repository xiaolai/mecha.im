import { describe, it, expect } from "vitest";
import { buildHierarchy, flattenHierarchy } from "../src/hierarchy.js";
import type { FindResult } from "../src/bot.js";
import type { BotName } from "@mecha/core";

function mkResult(name: string, workspacePath: string): FindResult {
  return {
    name: name as BotName,
    state: "running",
    port: 7700,
    pid: 1000,
    workspacePath,
    tags: [],
  };
}

describe("buildHierarchy", () => {
  it("returns flat list when no nesting", () => {
    const bots = [
      mkResult("alice", "/home/user/project-a"),
      mkResult("bob", "/home/user/project-b"),
    ];
    const roots = buildHierarchy(bots);
    expect(roots).toHaveLength(2);
    expect(roots[0].depth).toBe(0);
    expect(roots[1].depth).toBe(0);
    expect(roots[0].children).toHaveLength(0);
  });

  it("nests child under parent by workspace prefix", () => {
    const bots = [
      mkResult("parent", "/home/user/project"),
      mkResult("child", "/home/user/project/sub"),
    ];
    const roots = buildHierarchy(bots);
    expect(roots).toHaveLength(1);
    expect(roots[0].bot.name).toBe("parent");
    expect(roots[0].children).toHaveLength(1);
    expect(roots[0].children[0].bot.name).toBe("child");
    expect(roots[0].children[0].depth).toBe(1);
  });

  it("handles multi-level nesting", () => {
    const bots = [
      mkResult("root", "/a"),
      mkResult("mid", "/a/b"),
      mkResult("leaf", "/a/b/c"),
    ];
    const roots = buildHierarchy(bots);
    expect(roots).toHaveLength(1);
    expect(roots[0].children[0].children[0].bot.name).toBe("leaf");
    expect(roots[0].children[0].children[0].depth).toBe(2);
  });

  it("picks deepest parent when multiple candidates", () => {
    const bots = [
      mkResult("root", "/a"),
      mkResult("mid", "/a/b"),
      mkResult("leaf", "/a/b/c"),
    ];
    const roots = buildHierarchy(bots);
    // leaf should be child of mid, not root
    expect(roots[0].children[0].children).toHaveLength(1);
    expect(roots[0].children).toHaveLength(1);
  });

  it("handles empty workspace paths", () => {
    const bots = [
      { ...mkResult("alice", "/ws"), workspacePath: undefined as unknown as string },
      mkResult("bob", "/ws/sub"),
    ];
    const roots = buildHierarchy(bots);
    expect(roots).toHaveLength(2);
  });

  it("does not nest when workspace is prefix but not a directory boundary", () => {
    const bots = [
      mkResult("parent", "/home/pro"),
      mkResult("notchild", "/home/project"),
    ];
    const roots = buildHierarchy(bots);
    // "project" starts with "pro" but not "pro/" — should NOT be nested
    expect(roots).toHaveLength(2);
  });

  it("returns empty for empty input", () => {
    expect(buildHierarchy([])).toEqual([]);
  });
});

describe("flattenHierarchy", () => {
  it("flattens tree in display order", () => {
    const bots = [
      mkResult("root", "/a"),
      mkResult("child1", "/a/b"),
      mkResult("child2", "/a/c"),
      mkResult("grandchild", "/a/b/d"),
    ];
    const roots = buildHierarchy(bots);
    const flat = flattenHierarchy(roots);

    expect(flat.map(f => f.bot.name)).toEqual(["root", "child1", "grandchild", "child2"]);
    expect(flat.map(f => f.depth)).toEqual([0, 1, 2, 1]);
  });

  it("returns empty for empty roots", () => {
    expect(flattenHierarchy([])).toEqual([]);
  });

  it("handles multiple root trees", () => {
    const bots = [
      mkResult("tree1", "/x"),
      mkResult("tree1child", "/x/y"),
      mkResult("tree2", "/z"),
    ];
    const roots = buildHierarchy(bots);
    const flat = flattenHierarchy(roots);

    expect(flat).toHaveLength(3);
    expect(flat[0].bot.name).toBe("tree1");
    expect(flat[1].bot.name).toBe("tree1child");
    expect(flat[2].bot.name).toBe("tree2");
  });
});
