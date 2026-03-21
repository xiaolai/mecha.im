import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadPricing, initPricing, computeCost, resolvePricing, getFallbackPricing, DEFAULT_PRICING } from "../src/pricing.js";
import type { PricingTable } from "../src/types.js";

describe("pricing", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  describe("loadPricing", () => {
    it("returns default pricing when file does not exist", () => {
      tempDir = mkdtempSync(join(tmpdir(), "meter-pricing-"));
      const result = loadPricing(tempDir);
      expect(result).toEqual(DEFAULT_PRICING);
    });

    it("returns default for JSON missing models field", () => {
      tempDir = mkdtempSync(join(tmpdir(), "meter-pricing-"));
      writeFileSync(join(tempDir, "pricing.json"), '{"version":1}');

      const result = loadPricing(tempDir);
      expect(result).toEqual(DEFAULT_PRICING);
    });

    it("loads pricing from disk", () => {
      tempDir = mkdtempSync(join(tmpdir(), "meter-pricing-"));
      const custom: PricingTable = {
        version: 2,
        updatedAt: "2026-03-01T00:00:00Z",
        models: {
          "test-model": {
            inputPerMillion: 1.0,
            outputPerMillion: 2.0,
            cacheCreationPerMillion: 1.5,
            cacheReadPerMillion: 0.1,
          },
        },
      };
      writeFileSync(join(tempDir, "pricing.json"), JSON.stringify(custom));

      const result = loadPricing(tempDir);
      expect(result.version).toBe(2);
      expect(result.models["test-model"]!.inputPerMillion).toBe(1.0);
    });
  });

  describe("initPricing", () => {
    it("creates pricing.json if missing", () => {
      tempDir = mkdtempSync(join(tmpdir(), "meter-pricing-"));
      initPricing(tempDir);

      const raw = readFileSync(join(tempDir, "pricing.json"), "utf-8");
      const parsed = JSON.parse(raw) as PricingTable;
      expect(parsed.models["claude-opus-4-6"]).toBeDefined();
    });

    it("does not overwrite existing pricing.json", () => {
      tempDir = mkdtempSync(join(tmpdir(), "meter-pricing-"));
      writeFileSync(join(tempDir, "pricing.json"), '{"version":99,"updatedAt":"x","models":{}}');

      initPricing(tempDir);

      const raw = readFileSync(join(tempDir, "pricing.json"), "utf-8");
      const parsed = JSON.parse(raw);
      expect(parsed.version).toBe(99);
    });
  });

  describe("computeCost", () => {
    it("computes cost correctly for claude-sonnet-4-6", () => {
      const pricing = DEFAULT_PRICING.models["claude-sonnet-4-6"]!;
      const cost = computeCost(pricing, {
        inputTokens: 1000,
        outputTokens: 500,
        cacheCreationTokens: 0,
        cacheReadTokens: 200,
      });
      // (1000 * 3 + 500 * 15 + 0 + 200 * 0.3) / 1_000_000
      // = (3000 + 7500 + 60) / 1_000_000 = 10560 / 1_000_000 = 0.01056
      expect(cost).toBeCloseTo(0.01056, 5);
    });

    it("returns 0 for zero tokens", () => {
      const pricing = DEFAULT_PRICING.models["claude-opus-4-6"]!;
      const cost = computeCost(pricing, {
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      });
      expect(cost).toBe(0);
    });

    it("includes cache creation cost", () => {
      const pricing = DEFAULT_PRICING.models["claude-opus-4-6"]!;
      const cost = computeCost(pricing, {
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationTokens: 1_000_000,
        cacheReadTokens: 0,
      });
      expect(cost).toBeCloseTo(18.75, 2);
    });
  });

  describe("getFallbackPricing", () => {
    it("returns most expensive model (by output rate)", () => {
      const fallback = getFallbackPricing(DEFAULT_PRICING);
      // claude-opus-4-6 has the highest outputPerMillion (75)
      expect(fallback.outputPerMillion).toBe(75.0);
    });
  });

  describe("resolvePricing", () => {
    it("returns matching model pricing", () => {
      const pricing = resolvePricing(DEFAULT_PRICING, "claude-sonnet-4-6");
      expect(pricing.outputPerMillion).toBe(15.0);
    });

    it("returns fallback for unknown model", () => {
      const pricing = resolvePricing(DEFAULT_PRICING, "claude-unknown-99");
      // Falls back to most expensive (opus)
      expect(pricing.outputPerMillion).toBe(75.0);
    });
  });
});
