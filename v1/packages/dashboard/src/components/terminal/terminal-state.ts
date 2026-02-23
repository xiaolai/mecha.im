let counter = 0;
function uid(): string {
  return `t${++counter}-${Math.random().toString(36).slice(2, 8)}`;
}

export type SplitDirection = "horizontal" | "vertical";

export interface PaneLeaf {
  kind: "leaf";
  id: string;
}

export interface PaneSplit {
  kind: "split";
  id: string;
  direction: SplitDirection;
  children: [PaneNode, PaneNode];
}

export type PaneNode = PaneLeaf | PaneSplit;

export interface TerminalTab {
  id: string;
  label: string;
  root: PaneNode;
}

export function createPane(): PaneLeaf {
  return { kind: "leaf", id: uid() };
}

export function createTab(index: number): TerminalTab {
  return {
    id: uid(),
    label: `Terminal ${index}`,
    root: createPane(),
  };
}

/** Split a pane by ID, returning a new tree root. */
export function splitPane(
  node: PaneNode,
  paneId: string,
  direction: SplitDirection,
): PaneNode {
  if (node.kind === "leaf") {
    if (node.id === paneId) {
      return {
        kind: "split",
        id: uid(),
        direction,
        children: [node, createPane()],
      };
    }
    return node;
  }

  return {
    ...node,
    children: [
      splitPane(node.children[0], paneId, direction),
      splitPane(node.children[1], paneId, direction),
    ],
  };
}

/** Remove a pane by ID, returning the new root (or null if tree is now empty). */
export function removePane(
  node: PaneNode,
  paneId: string,
): PaneNode | null {
  if (node.kind === "leaf") {
    return node.id === paneId ? null : node;
  }

  const [left, right] = node.children;
  const newLeft = removePane(left, paneId);
  const newRight = removePane(right, paneId);

  if (!newLeft && !newRight) return null;
  if (!newLeft) return newRight;
  if (!newRight) return newLeft;

  return { ...node, children: [newLeft, newRight] };
}

/** Count panes in a tree. */
export function countPanes(node: PaneNode): number {
  if (node.kind === "leaf") return 1;
  return countPanes(node.children[0]) + countPanes(node.children[1]);
}
