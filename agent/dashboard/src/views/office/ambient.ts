import type { ActivityState } from "./office-bridge";

export type PlantState = "healthy" | "drooping" | "wilted" | "dead";

export function getPlantState(consecutiveErrors: number): PlantState {
  if (consecutiveErrors === 0) return "healthy";
  if (consecutiveErrors <= 2) return "drooping";
  if (consecutiveErrors <= 4) return "wilted";
  return "dead";
}

export interface TintColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export function getWindowTint(hour: number): TintColor {
  if (hour >= 6 && hour <= 11) return { r: 255, g: 240, b: 200, a: 0.15 };
  if (hour >= 12 && hour <= 16) return { r: 255, g: 255, b: 255, a: 0 };
  if (hour >= 17 && hour <= 20) return { r: 255, g: 180, b: 100, a: 0.2 };
  return { r: 100, g: 120, b: 200, a: 0.3 };
}

export class CoffeeCounter {
  count = 0;
  private lastResetTime = Date.now();

  onActivityChange(prev: ActivityState, next: ActivityState): void {
    if (prev === "idle" && Date.now() - this.lastResetTime > 30 * 60_000) {
      this.count = 0;
    }
    if (prev === "idle" && next !== "idle") {
      this.count = Math.min(this.count + 1, 5);
      this.lastResetTime = Date.now();
    }
  }
}
