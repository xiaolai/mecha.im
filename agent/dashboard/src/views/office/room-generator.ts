import { MAP_COLS, MAP_ROWS } from "./tilemap-data";

/** Simple seeded PRNG (mulberry32) */
export class SeededRNG {
  private state: number;

  constructor(seed: number) {
    this.state = seed;
  }

  /** Returns float in [0, 1) */
  next(): number {
    this.state |= 0;
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Returns integer in [min, max) */
  int(min: number, max: number): number {
    return Math.floor(this.next() * (max - min)) + min;
  }

  /** Shuffle array in place */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(0, i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}

/** Hash a string to a 32-bit integer */
export function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return h;
}

/**
 * Decoration item to be placed on the tileset background.
 * Uses frame indices from "Office Tileset All 32x32 no shadow.png"
 * (16 cols × 32 rows = 512 frames, 32px each).
 */
export interface Decoration {
  tileX: number;
  tileY: number;
  frame: number;
  alpha?: number;
}

/** Frame indices for decorative items in the 32×32 tileset (16 cols per row) */
const PLANT_FRAMES = [304, 305, 306, 307, 308, 309]; // row 19, potted plants
const BOX_FRAMES = [310, 311, 312, 313, 314, 315];   // row 19-20, boxes/crates

/**
 * Generate random decoration placements for an office.
 *
 * @param walkable - Boolean array (MAP_COLS × MAP_ROWS), true = walkable tile
 * @param seed - Seed string (e.g., bot name) for deterministic randomization
 * @param occupiedTiles - Set of "x,y" strings for tiles already used by zones
 */
export function generateDecorations(
  walkable: boolean[],
  seed: string,
  occupiedTiles: Set<string>,
): Decoration[] {
  const rng = new SeededRNG(hashString(seed));
  const decorations: Decoration[] = [];

  // Collect candidate wall-adjacent floor tiles for decorations
  const candidates: [number, number][] = [];
  for (let y = 1; y < MAP_ROWS - 1; y++) {
    for (let x = 1; x < MAP_COLS - 1; x++) {
      if (!walkable[y * MAP_COLS + x]) continue;
      if (occupiedTiles.has(`${x},${y}`)) continue;

      // Prefer tiles near walls (at least one non-walkable neighbor)
      const nearWall =
        !walkable[(y - 1) * MAP_COLS + x] ||
        !walkable[(y + 1) * MAP_COLS + x] ||
        !walkable[y * MAP_COLS + (x - 1)] ||
        !walkable[y * MAP_COLS + (x + 1)];
      if (nearWall) candidates.push([x, y]);
    }
  }

  rng.shuffle(candidates);

  // Place 3-6 plants near walls
  const plantCount = rng.int(3, 7);
  for (let i = 0; i < Math.min(plantCount, candidates.length); i++) {
    const [x, y] = candidates[i];
    decorations.push({
      tileX: x,
      tileY: y,
      frame: PLANT_FRAMES[rng.int(0, PLANT_FRAMES.length)],
    });
  }

  // Collect corner/edge candidates for boxes (not overlapping plants)
  const usedDeco = new Set(decorations.map((d) => `${d.tileX},${d.tileY}`));
  const boxCandidates = candidates.filter(([x, y]) => !usedDeco.has(`${x},${y}`));
  rng.shuffle(boxCandidates);

  // Place 2-4 boxes
  const boxCount = rng.int(2, 5);
  for (let i = 0; i < Math.min(boxCount, boxCandidates.length); i++) {
    const [x, y] = boxCandidates[i];
    decorations.push({
      tileX: x,
      tileY: y,
      frame: BOX_FRAMES[rng.int(0, BOX_FRAMES.length)],
      alpha: 0.85,
    });
  }

  return decorations;
}
