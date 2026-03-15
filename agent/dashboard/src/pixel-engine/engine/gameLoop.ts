import { MAX_DELTA_TIME_SEC } from '../constants.js';

export interface GameLoopCallbacks {
  update: (dt: number) => void;
  render: (ctx: CanvasRenderingContext2D) => void;
}

export function startGameLoop(
  canvas: HTMLCanvasElement,
  callbacks: GameLoopCallbacks,
): { stop: () => void; pause: () => void; resume: () => void } {
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;

  let lastTime = 0;
  let rafId = 0;
  let running = true;

  const frame = (time: number) => {
    if (!running) return;
    const dt = lastTime === 0 ? 0 : Math.min((time - lastTime) / 1000, MAX_DELTA_TIME_SEC);
    lastTime = time;

    callbacks.update(dt);

    ctx.imageSmoothingEnabled = false;
    callbacks.render(ctx);

    rafId = requestAnimationFrame(frame);
  };

  rafId = requestAnimationFrame(frame);

  return {
    stop() {
      running = false;
      cancelAnimationFrame(rafId);
    },
    pause() {
      running = false;
      cancelAnimationFrame(rafId);
    },
    resume() {
      if (running) return;
      running = true;
      lastTime = 0;
      rafId = requestAnimationFrame(frame);
    },
  };
}
