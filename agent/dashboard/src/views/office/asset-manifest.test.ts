import { describe, it, expect } from "vitest";
import { ASSETS } from "./asset-manifest";

describe("asset-manifest", () => {
  it("has required keys for character rendering", () => {
    expect(ASSETS.body).toBeDefined();
    expect(ASSETS.shadow).toBeDefined();
    expect(ASSETS.hairs).toBeDefined();
  });

  it("has at least 6 outfit entries", () => {
    const outfitKeys = Object.keys(ASSETS).filter((k) => k.startsWith("outfit"));
    expect(outfitKeys.length).toBeGreaterThanOrEqual(6);
  });

  it("has tileset entry", () => {
    expect(ASSETS.tileset32).toBeDefined();
  });

  it("all paths start with /dashboard/pixel-assets/", () => {
    for (const [key, path] of Object.entries(ASSETS)) {
      expect(path, `${key} path`).toMatch(/^\/dashboard\/pixel-assets\//);
    }
  });
});
