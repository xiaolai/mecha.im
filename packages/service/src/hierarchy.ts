import type { FindResult } from "./casa.js";

export interface HierarchyNode {
  casa: FindResult;
  children: HierarchyNode[];
  depth: number;
}

/**
 * Build a tree of CASAs based on workspace path nesting.
 * A CASA is a child of another if its workspace is a subdirectory.
 */
export function buildHierarchy(casas: FindResult[]): HierarchyNode[] {
  // Sort by workspace path length so parents come first
  /* v8 ignore start -- sort comparator branches: null coalescing + tiebreaker */
  const sorted = [...casas].sort((a, b) => {
    const wa = a.workspacePath ?? "";
    const wb = b.workspacePath ?? "";
    return wa.length - wb.length || wa.localeCompare(wb);
  });
  /* v8 ignore stop */

  const roots: HierarchyNode[] = [];
  const nodes: HierarchyNode[] = [];

  for (const casa of sorted) {
    const node: HierarchyNode = { casa, children: [], depth: 0 };
    /* v8 ignore start -- null coalescing fallbacks for optional workspacePath */
    const wp = casa.workspacePath ?? "";

    // Find the deepest parent by scanning in reverse (longest path first)
    let parent: HierarchyNode | undefined;
    for (let i = nodes.length - 1; i >= 0; i--) {
      const cwp = nodes[i]!.casa.workspacePath ?? "";
      if (cwp && wp.startsWith(cwp + "/")) {
        parent = nodes[i]!;
        break; // reverse scan: first match is the deepest parent
      }
    }
    /* v8 ignore stop */

    if (parent) {
      node.depth = parent.depth + 1;
      parent.children.push(node);
    } else {
      roots.push(node);
    }
    nodes.push(node);
  }

  return roots;
}

/** Flatten a hierarchy tree to a display-order list with depth info. */
export function flattenHierarchy(roots: HierarchyNode[]): { casa: FindResult; depth: number }[] {
  const result: { casa: FindResult; depth: number }[] = [];

  function walk(nodes: HierarchyNode[]): void {
    for (const node of nodes) {
      result.push({ casa: node.casa, depth: node.depth });
      walk(node.children);
    }
  }

  walk(roots);
  return result;
}
