import { MAP_COLS, MAP_ROWS } from "./tilemap-data";

/**
 * BFS pathfinding on a 2D tile grid.
 * Returns a list of [x, y] waypoints from start to end (inclusive).
 * If no path is found, returns a direct two-point path.
 */
export function findPath(
  walkable: boolean[],
  startX: number,
  startY: number,
  endX: number,
  endY: number,
): [number, number][] {
  if (startX === endX && startY === endY) return [[startX, startY]];

  const key = (x: number, y: number) => y * MAP_COLS + x;
  const start = key(startX, startY);
  const end = key(endX, endY);

  const visited = new Set<number>();
  const parent = new Map<number, number>();
  const queue: number[] = [start];
  visited.add(start);

  const dirs = [
    [0, -1], [0, 1], [-1, 0], [1, 0], // cardinal
    [-1, -1], [1, -1], [-1, 1], [1, 1], // diagonal
  ];

  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur === end) break;

    const cx = cur % MAP_COLS;
    const cy = Math.floor(cur / MAP_COLS);

    for (const [dx, dy] of dirs) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || nx >= MAP_COLS || ny < 0 || ny >= MAP_ROWS) continue;

      const nk = key(nx, ny);
      if (visited.has(nk) || !walkable[nk]) continue;

      // Diagonal: both adjacent cardinals must be walkable to prevent corner-cutting
      if (dx !== 0 && dy !== 0) {
        if (!walkable[key(cx + dx, cy)] || !walkable[key(cx, cy + dy)]) continue;
      }

      visited.add(nk);
      parent.set(nk, cur);
      queue.push(nk);
    }
  }

  if (!parent.has(end)) {
    // No path found — fallback to direct line
    return [[startX, startY], [endX, endY]];
  }

  // Reconstruct path
  const path: [number, number][] = [];
  let cur = end;
  while (cur !== start) {
    path.push([cur % MAP_COLS, Math.floor(cur / MAP_COLS)]);
    cur = parent.get(cur)!;
  }
  path.push([startX, startY]);
  path.reverse();

  // Simplify: remove intermediate points that are on the same line
  return simplifyPath(path);
}

/** Remove collinear intermediate points to produce smoother walks */
function simplifyPath(path: [number, number][]): [number, number][] {
  if (path.length <= 2) return path;

  const result: [number, number][] = [path[0]];
  for (let i = 1; i < path.length - 1; i++) {
    const [px, py] = result[result.length - 1];
    const [cx, cy] = path[i];
    const [nx, ny] = path[i + 1];
    // Keep point if direction changes
    if ((nx - cx) !== (cx - px) || (ny - cy) !== (cy - py)) {
      result.push(path[i]);
    }
  }
  result.push(path[path.length - 1]);
  return result;
}
