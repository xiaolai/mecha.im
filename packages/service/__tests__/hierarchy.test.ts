import { describe, it, expect } from "vitest";
import { buildHierarchy, flattenHierarchy } from "../src/hierarchy.js";
import type { FindResult } from "../src/casa.js";
import type { CasaName } from "@mecha/core";

function mkResult(name: string, workspacePath: string): FindResult {
  return {
    name: name as CasaName,
    state: "running",
    port: 7700,
    pid: 1000,
    workspacePath,
    tags: [],
  };
}

describe("buildHierarchy", () => {
  it("returns flat list when no nesting", () => {
    const casas = [
      mkResult("alice", "/home/user/project-a"),
      mkResult("bob", "/home/user/project-b"),
    ];
    const roots = buildHierarchy(casas);
    expect(roots).toHaveLength(2);
    expect(roots[0].depth).toBe(0);
    expect(roots[1].depth).toBe(0);
    expect(roots[0].children).toHaveLength(0);
  });

  it("nests child under parent by workspace prefix", () => {
    const casas = [
      mkResult("parent", "/home/user/project"),
      mkResult("child", "/home/user/project/sub"),
    ];
    const roots = buildHierarchy(casas);
    expect(roots).toHaveLength(1);
    expect(roots[0].casa.name).toBe("parent");
    expect(roots[0].children).toHaveLength(1);
    expect(roots[0].children[0].casa.name).toBe("child");
    expect(roots[0].children[0].depth).toBe(1);
  });

  it("handles multi-level nesting", () => {
    const casas = [
      mkResult("root", "/a"),
      mkResult("mid", "/a/b"),
      mkResult("leaf", "/a/b/c"),
    ];
    const roots = buildHierarchy(casas);
    expect(roots).toHaveLength(1);
    expect(roots[0].children[0].children[0].casa.name).toBe("leaf");
    expect(roots[0].children[0].children[0].depth).toBe(2);
  });

  it("picks deepest parent when multiple candidates", () => {
    const casas = [
      mkResult("root", "/a"),
      mkResult("mid", "/a/b"),
      mkResult("leaf", "/a/b/c"),
    ];
    const roots = buildHierarchy(casas);
    // leaf should be child of mid, not root
    expect(roots[0].children[0].children).toHaveLength(1);
    expect(roots[0].children).toHaveLength(1);
  });

  it("handles empty workspace paths", () => {
    const casas = [
      { ...mkResult("alice", "/ws"), workspacePath: undefined as unknown as string },
      mkResult("bob", "/ws/sub"),
    ];
    const roots = buildHierarchy(casas);
    expect(roots).toHaveLength(2);
  });

  it("does not nest when workspace is prefix but not a directory boundary", () => {
    const casas = [
      mkResult("parent", "/home/pro"),
      mkResult("notchild", "/home/project"),
    ];
    const roots = buildHierarchy(casas);
    // "project" starts with "pro" but not "pro/" — should NOT be nested
    expect(roots).toHaveLength(2);
  });

  it("returns empty for empty input", () => {
    expect(buildHierarchy([])).toEqual([]);
  });
});

describe("flattenHierarchy", () => {
  it("flattens tree in display order", () => {
    const casas = [
      mkResult("root", "/a"),
      mkResult("child1", "/a/b"),
      mkResult("child2", "/a/c"),
      mkResult("grandchild", "/a/b/d"),
    ];
    const roots = buildHierarchy(casas);
    const flat = flattenHierarchy(roots);

    expect(flat.map(f => f.casa.name)).toEqual(["root", "child1", "grandchild", "child2"]);
    expect(flat.map(f => f.depth)).toEqual([0, 1, 2, 1]);
  });

  it("returns empty for empty roots", () => {
    expect(flattenHierarchy([])).toEqual([]);
  });

  it("handles multiple root trees", () => {
    const casas = [
      mkResult("tree1", "/x"),
      mkResult("tree1child", "/x/y"),
      mkResult("tree2", "/z"),
    ];
    const roots = buildHierarchy(casas);
    const flat = flattenHierarchy(roots);

    expect(flat).toHaveLength(3);
    expect(flat[0].casa.name).toBe("tree1");
    expect(flat[1].casa.name).toBe("tree1child");
    expect(flat[2].casa.name).toBe("tree2");
  });
});
