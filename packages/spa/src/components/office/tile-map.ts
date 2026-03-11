const TILE_SIZE = 32;

/** Office grid dimensions (in tiles). */
export const GRID_WIDTH = 16;
export const GRID_HEIGHT = 14;

/** Canvas pixel dimensions. */
export const CANVAS_WIDTH = GRID_WIDTH * TILE_SIZE;
export const CANVAS_HEIGHT = GRID_HEIGHT * TILE_SIZE;

/**
 * Render the static office background.
 * Uses basic canvas drawing until tileset images are loaded.
 */
export function renderTileMap(ctx: CanvasRenderingContext2D): void {
  // Background
  ctx.fillStyle = "#2a2a3a";
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  // Floor tiles (checkerboard)
  for (let y = 0; y < GRID_HEIGHT; y++) {
    for (let x = 0; x < GRID_WIDTH; x++) {
      const isLight = (x + y) % 2 === 0;
      ctx.fillStyle = isLight ? "#3a3a4a" : "#2e2e3e";
      ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    }
  }

  // Work area (left side)
  ctx.fillStyle = "#333344";
  ctx.fillRect(0, 3 * TILE_SIZE, 10 * TILE_SIZE, 9 * TILE_SIZE);

  // Lounge area (right side)
  ctx.fillStyle = "#2d3344";
  ctx.fillRect(11 * TILE_SIZE, 3 * TILE_SIZE, 5 * TILE_SIZE, 9 * TILE_SIZE);

  // Divider wall
  ctx.fillStyle = "#555566";
  ctx.fillRect(10 * TILE_SIZE, 3 * TILE_SIZE, TILE_SIZE / 2, 9 * TILE_SIZE);

  // Desks (6 positions)
  const deskPositions = [
    [2, 4], [6, 4], [2, 7], [6, 7], [2, 10], [6, 10],
  ];
  ctx.fillStyle = "#665544";
  for (const [dx, dy] of deskPositions) {
    ctx.fillRect(dx! * TILE_SIZE - 8, dy! * TILE_SIZE - 4, TILE_SIZE + 16, TILE_SIZE + 8);
    // Monitor
    ctx.fillStyle = "#4488aa";
    ctx.fillRect(dx! * TILE_SIZE + 4, dy! * TILE_SIZE - 2, TILE_SIZE - 8, TILE_SIZE - 12);
    ctx.fillStyle = "#665544";
  }

  // Water cooler
  ctx.fillStyle = "#66aadd";
  ctx.fillRect(2 * TILE_SIZE + 8, 2 * TILE_SIZE + 8, TILE_SIZE - 16, TILE_SIZE - 8);

  // Couches
  ctx.fillStyle = "#885544";
  ctx.fillRect(12 * TILE_SIZE, 4 * TILE_SIZE, TILE_SIZE * 2, TILE_SIZE);
  ctx.fillRect(12 * TILE_SIZE, 7 * TILE_SIZE, TILE_SIZE * 2, TILE_SIZE);

  // Labels
  ctx.fillStyle = "#aaaacc";
  ctx.font = "10px monospace";
  ctx.fillText("WORK", 4 * TILE_SIZE, TILE_SIZE + 12);
  ctx.fillText("LOUNGE", 12 * TILE_SIZE, TILE_SIZE + 12);
  ctx.fillText("WATER COOLER", TILE_SIZE, 2 * TILE_SIZE - 4);
}
