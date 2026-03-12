import { describe, it, expect } from "vitest";
import { getPlantState, getWindowTint, CoffeeCounter } from "./ambient";

describe("ambient", () => {
  describe("plant state", () => {
    it("healthy when 0 errors", () => {
      expect(getPlantState(0)).toBe("healthy");
    });
    it("drooping for 1-2 errors", () => {
      expect(getPlantState(1)).toBe("drooping");
      expect(getPlantState(2)).toBe("drooping");
    });
    it("wilted for 3-4 errors", () => {
      expect(getPlantState(3)).toBe("wilted");
      expect(getPlantState(4)).toBe("wilted");
    });
    it("dead for 5+ errors", () => {
      expect(getPlantState(5)).toBe("dead");
      expect(getPlantState(10)).toBe("dead");
    });
  });

  describe("window tint", () => {
    it("morning yellow from 6-11", () => {
      expect(getWindowTint(8)).toEqual({ r: 255, g: 240, b: 200, a: 0.15 });
    });
    it("midday clear from 12-16", () => {
      expect(getWindowTint(14)).toEqual({ r: 255, g: 255, b: 255, a: 0 });
    });
    it("evening orange from 17-20", () => {
      expect(getWindowTint(18)).toEqual({ r: 255, g: 180, b: 100, a: 0.2 });
    });
    it("night blue from 21-5", () => {
      expect(getWindowTint(23)).toEqual({ r: 100, g: 120, b: 200, a: 0.3 });
      expect(getWindowTint(3)).toEqual({ r: 100, g: 120, b: 200, a: 0.3 });
    });
  });

  describe("coffee counter", () => {
    it("starts at 0", () => {
      const cc = new CoffeeCounter();
      expect(cc.count).toBe(0);
    });
    it("increments on activity transition from idle", () => {
      const cc = new CoffeeCounter();
      cc.onActivityChange("idle", "thinking");
      expect(cc.count).toBe(1);
    });
    it("does not increment on non-idle transitions", () => {
      const cc = new CoffeeCounter();
      cc.onActivityChange("thinking", "calling");
      expect(cc.count).toBe(0);
    });
    it("caps at 5", () => {
      const cc = new CoffeeCounter();
      for (let i = 0; i < 8; i++) {
        cc.onActivityChange("idle", "thinking");
      }
      expect(cc.count).toBe(5);
    });
  });
});
