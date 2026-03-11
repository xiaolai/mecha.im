import type { BotState } from "./types";

const TILE_SIZE = 32;
const HIT_SIZE = 28;

/** Test if a click position hits a bot sprite. Returns bot name or null. */
export function hitTest(
  bots: BotState[],
  canvasX: number,
  canvasY: number,
): string | null {
  // Check in reverse order (last rendered = on top)
  for (let i = bots.length - 1; i >= 0; i--) {
    const bot = bots[i]!;
    const px = bot.position.x * TILE_SIZE;
    const py = bot.position.y * TILE_SIZE;

    if (
      canvasX >= px && canvasX <= px + HIT_SIZE &&
      canvasY >= py && canvasY <= py + HIT_SIZE
    ) {
      return bot.name;
    }
  }
  return null;
}

/** Get canvas-relative coordinates from a mouse event. */
export function getCanvasCoords(
  event: MouseEvent,
  canvas: HTMLCanvasElement,
): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY,
  };
}
