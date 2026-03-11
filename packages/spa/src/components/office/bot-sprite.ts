import type { BotState } from "./types";

const TILE_SIZE = 32;
const SPRITE_SIZE = 24;
const MOVE_SPEED = 2; // pixels per frame

/** Color palette for different bots. */
const BOT_COLORS = [
  "#4a9eff", "#ff6b6b", "#51cf66", "#ffd43b",
  "#cc5de8", "#ff922b", "#20c997", "#f06595",
  "#748ffc", "#a9e34b", "#22b8cf", "#e599f7",
];

/** Get bot color by index. */
function getBotColor(deskIndex: number): string {
  return BOT_COLORS[deskIndex % BOT_COLORS.length]!;
}

/** Interpolate position toward target. Returns true if still moving. */
export function updatePosition(state: BotState): boolean {
  const dx = state.targetPosition.x * TILE_SIZE - state.position.x * TILE_SIZE;
  const dy = state.targetPosition.y * TILE_SIZE - state.position.y * TILE_SIZE;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist < MOVE_SPEED) {
    state.position = { ...state.targetPosition };
    return false;
  }

  state.position = {
    x: state.position.x + (dx / dist) * MOVE_SPEED / TILE_SIZE,
    y: state.position.y + (dy / dist) * MOVE_SPEED / TILE_SIZE,
  };
  return true;
}

/** Render a single bot sprite. */
export function renderBotSprite(
  ctx: CanvasRenderingContext2D,
  state: BotState,
  frameCount: number,
): void {
  const px = state.position.x * TILE_SIZE;
  const py = state.position.y * TILE_SIZE;
  const color = getBotColor(state.deskIndex);

  // Body (pixel art style)
  ctx.fillStyle = color;
  ctx.fillRect(px + 4, py + 8, SPRITE_SIZE - 8, SPRITE_SIZE - 8);

  // Head
  ctx.fillRect(px + 6, py + 2, SPRITE_SIZE - 12, 10);

  // Eyes
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(px + 8, py + 4, 3, 3);
  ctx.fillRect(px + 15, py + 4, 3, 3);

  // Pupils (blink animation)
  if (frameCount % 120 < 110) {
    ctx.fillStyle = "#111111";
    ctx.fillRect(px + 9, py + 5, 2, 2);
    ctx.fillRect(px + 16, py + 5, 2, 2);
  }

  // Activity-specific animation
  renderActivityAnimation(ctx, state, px, py, frameCount);

  // Name label
  ctx.fillStyle = "#ffffff";
  ctx.font = "9px monospace";
  ctx.textAlign = "center";
  ctx.fillText(state.name, px + SPRITE_SIZE / 2 + 2, py + TILE_SIZE + 8);
  ctx.textAlign = "start";
}

function renderActivityAnimation(
  ctx: CanvasRenderingContext2D,
  state: BotState,
  px: number,
  py: number,
  frame: number,
): void {
  switch (state.activity) {
    case "thinking": {
      // Thought bubble with "..."
      const bobY = Math.sin(frame * 0.05) * 2;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.ellipse(px + SPRITE_SIZE + 8, py - 4 + bobY, 14, 10, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#333333";
      ctx.font = "bold 10px monospace";
      ctx.fillText("...", px + SPRITE_SIZE, py - 2 + bobY);
      break;
    }
    case "tool_use": {
      // Tool icon floating above
      ctx.fillStyle = "#ffd43b";
      ctx.font = "10px monospace";
      const toolLabel = state.toolName ?? "tool";
      ctx.fillText(toolLabel, px - 2, py - 4);
      // Typing animation (hands)
      if (frame % 10 < 5) {
        ctx.fillStyle = getBotColor(state.deskIndex);
        ctx.fillRect(px + 2, py + SPRITE_SIZE, 4, 3);
        ctx.fillRect(px + SPRITE_SIZE - 6, py + SPRITE_SIZE, 4, 3);
      }
      break;
    }
    case "responding": {
      // Speech bubble
      const bobY = Math.sin(frame * 0.08) * 1;
      ctx.fillStyle = "#51cf66";
      ctx.beginPath();
      ctx.ellipse(px + SPRITE_SIZE + 10, py - 4 + bobY, 16, 10, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.font = "8px monospace";
      ctx.fillText("abc", px + SPRITE_SIZE + 1, py - 1 + bobY);
      break;
    }
    case "error": {
      // Red exclamation mark
      ctx.fillStyle = "#ff6b6b";
      ctx.font = "bold 16px sans-serif";
      const flash = frame % 30 < 15;
      if (flash) {
        ctx.fillText("!", px + SPRITE_SIZE / 2, py - 4);
      }
      break;
    }
  }
}
