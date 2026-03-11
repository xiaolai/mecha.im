import type { BotState } from "./types";

const TILE_SIZE = 32;

/** Render status bubbles for all bots that have quests or special states. */
export function renderBubbles(
  ctx: CanvasRenderingContext2D,
  bots: BotState[],
  frameCount: number,
): void {
  for (const bot of bots) {
    if (bot.activity === "error") {
      renderQuestMarker(ctx, bot, "#ff6b6b", "!", frameCount);
    }
  }
}

function renderQuestMarker(
  ctx: CanvasRenderingContext2D,
  bot: BotState,
  markerColor: string,
  text: string,
  frame: number,
): void {
  const px = bot.position.x * TILE_SIZE + 12;
  const py = bot.position.y * TILE_SIZE - 12;
  const bobY = Math.sin(frame * 0.06) * 3;

  // Marker background
  ctx.fillStyle = markerColor;
  ctx.beginPath();
  ctx.arc(px, py + bobY, 8, 0, Math.PI * 2);
  ctx.fill();

  // Text
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 12px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(text, px, py + bobY + 4);
  ctx.textAlign = "start";
}
