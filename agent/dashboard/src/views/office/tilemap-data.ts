export const TILE_SIZE = 32;
export const MAP_COLS = 16;
export const MAP_ROWS = 14;
export const CANVAS_WIDTH = MAP_COLS * TILE_SIZE;   // 512
export const CANVAS_HEIGHT = MAP_ROWS * TILE_SIZE;  // 448

const F = 0;   // Floor
const W = -1;  // Wall

export const FLOOR_LAYER: number[] = [
  W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W,
  W, F, F, F, F, F, F, F, F, F, F, F, F, F, F, W,
  W, F, F, F, F, F, F, F, F, F, F, F, F, F, F, W,
  W, F, F, F, F, F, F, F, F, F, F, F, F, F, F, W,
  W, F, F, F, F, F, F, F, F, F, F, F, F, F, F, W,
  W, F, F, F, F, F, F, F, F, F, F, F, F, F, F, W,
  W, F, F, F, F, F, F, F, F, F, F, F, F, F, F, W,
  W, F, F, F, F, F, F, F, F, F, F, F, F, F, F, W,
  W, F, F, F, F, F, F, F, F, F, F, F, F, F, F, W,
  W, F, F, F, F, F, F, F, F, F, F, F, F, F, F, W,
  W, F, F, F, F, F, F, F, F, F, F, F, F, F, F, W,
  W, F, F, F, F, F, F, F, F, F, F, F, F, F, F, W,
  W, F, F, F, F, F, F, F, F, F, F, F, F, F, F, W,
  W, W, W, W, W, W, W, F, W, W, W, W, W, W, W, W,
];

export const FURNITURE_LAYER: number[] = new Array(MAP_COLS * MAP_ROWS).fill(-1);
