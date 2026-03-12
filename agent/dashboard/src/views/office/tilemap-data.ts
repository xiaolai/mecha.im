export const TILE_SIZE = 32;
export const MAP_COLS = 16;
export const MAP_ROWS = 14;
export const CANVAS_WIDTH = MAP_COLS * TILE_SIZE;   // 512
export const CANVAS_HEIGHT = MAP_ROWS * TILE_SIZE;  // 448

/**
 * Walkable grid for the Office Level 3 layout (16×14).
 * true = walkable floor, false = wall or large furniture.
 *
 * The layout has two rooms connected by an opening:
 * - Left room (cols 1-9): main work area with desk rows
 * - Right room (cols 11-14): break/meeting area
 * - Connection at rows 5-7, col 10
 * - Doors at bottom (col 7 and col 12)
 */
const W = false; // wall / non-walkable
const F = true;  // floor / walkable

// prettier-ignore
export const WALKABLE: boolean[] = [
  // col: 0  1  2  3  4  5  6  7  8  9  10 11 12 13 14 15
  /*r0*/  W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W,
  /*r1*/  W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W,
  /*r2*/  W, F, F, F, F, F, F, F, F, F, W, F, F, F, F, W,
  /*r3*/  W, F, W, W, F, W, W, F, F, F, W, F, F, F, F, W,
  /*r4*/  W, F, F, F, F, F, F, F, F, F, W, F, F, F, F, W,
  /*r5*/  W, F, W, W, F, W, W, F, F, F, F, F, F, F, F, W,
  /*r6*/  W, F, F, F, F, F, F, F, F, F, F, F, F, F, F, W,
  /*r7*/  W, F, W, W, F, W, W, F, F, F, F, F, F, F, F, W,
  /*r8*/  W, F, F, F, F, F, F, F, F, F, W, F, F, F, F, W,
  /*r9*/  W, F, F, F, F, F, F, F, F, F, W, F, F, F, F, W,
  /*r10*/ W, F, F, F, F, F, F, F, F, F, W, F, F, F, F, W,
  /*r11*/ W, F, F, F, F, F, F, F, F, F, W, F, F, F, F, W,
  /*r12*/ W, F, F, F, F, F, F, F, F, F, F, F, F, F, F, W,
  /*r13*/ W, W, W, W, W, W, W, F, W, W, W, W, F, W, W, W,
];

// Legacy export for backwards compat (used by old drawFloor — now unused)
export const FLOOR_LAYER: number[] = WALKABLE.map((w) => (w ? 0 : -1));
export const FURNITURE_LAYER: number[] = new Array(MAP_COLS * MAP_ROWS).fill(-1);
