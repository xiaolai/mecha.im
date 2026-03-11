import { useRef, useEffect, useCallback, useState } from "react";
import { OfficeActivityManager } from "./activity-manager";
import { useActivityStream } from "./use-activity-stream";
import { renderTileMap, CANVAS_WIDTH, CANVAS_HEIGHT } from "./tile-map";
import { renderBotSprite, updatePosition } from "./bot-sprite";
import { renderBubbles } from "./bubble-renderer";
import { hitTest, getCanvasCoords } from "./interaction-layer";
import type { ActivityEvent } from "./types";

interface OfficeCanvasProps {
  onBotClick?: (name: string) => void;
}

export function OfficeCanvas({ onBotClick }: OfficeCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const managerRef = useRef(new OfficeActivityManager());
  const frameRef = useRef(0);
  const [, setBotCount] = useState(0);

  const handleEvent = useCallback((event: ActivityEvent) => {
    managerRef.current.handleEvent(event);
    setBotCount(managerRef.current.getAllBotStates().length);
  }, []);

  useActivityStream(handleEvent);

  // Render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Pre-render tilemap
    const offscreen = new OffscreenCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
    const offCtx = offscreen.getContext("2d")!;
    renderTileMap(offCtx as unknown as CanvasRenderingContext2D);

    let animId: number;

    function frame() {
      frameRef.current++;
      const fc = frameRef.current;

      // Clear and draw cached tilemap
      ctx!.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      ctx!.drawImage(offscreen, 0, 0);

      // Update and draw bots
      const bots = managerRef.current.getAllBotStates();
      for (const bot of bots) {
        updatePosition(bot);
        renderBotSprite(ctx!, bot, fc);
      }

      // Bubbles
      renderBubbles(ctx!, bots, fc);

      animId = requestAnimationFrame(frame);
    }

    animId = requestAnimationFrame(frame);

    return () => cancelAnimationFrame(animId);
  }, []);

  // Click handler
  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !onBotClick) return;

    const coords = getCanvasCoords(e.nativeEvent, canvas);
    const bots = managerRef.current.getAllBotStates();
    const hit = hitTest(bots, coords.x, coords.y);
    if (hit) onBotClick(hit);
  }, [onBotClick]);

  return (
    <canvas
      ref={canvasRef}
      width={CANVAS_WIDTH}
      height={CANVAS_HEIGHT}
      onClick={handleClick}
      className="w-full max-w-2xl rounded-lg border border-border cursor-pointer"
      style={{ imageRendering: "pixelated" }}
    />
  );
}
