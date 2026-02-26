import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import type { ModelPricing, PricingTable } from "./types.js";

/** Hardcoded default pricing — used as fallback if pricing.json is corrupt */
export const DEFAULT_PRICING: PricingTable = {
  version: 1,
  updatedAt: "2026-02-26T00:00:00Z",
  models: {
    "claude-opus-4-6": {
      inputPerMillion: 15.0,
      outputPerMillion: 75.0,
      cacheCreationPerMillion: 18.75,
      cacheReadPerMillion: 1.5,
    },
    "claude-sonnet-4-6": {
      inputPerMillion: 3.0,
      outputPerMillion: 15.0,
      cacheCreationPerMillion: 3.75,
      cacheReadPerMillion: 0.3,
    },
    "claude-haiku-4-5": {
      inputPerMillion: 0.8,
      outputPerMillion: 4.0,
      cacheCreationPerMillion: 1.0,
      cacheReadPerMillion: 0.08,
    },
  },
};

/** Load pricing table from disk, falling back to defaults on error */
export function loadPricing(meterDir: string): PricingTable {
  const pricingPath = join(meterDir, "pricing.json");
  try {
    const raw = readFileSync(pricingPath, "utf-8");
    const parsed = JSON.parse(raw) as PricingTable;
    if (!parsed.models || typeof parsed.models !== "object") {
      throw new Error("Missing models field");
    }
    return parsed;
  } catch {
    /* v8 ignore start -- corrupt/missing file fallback */
    return DEFAULT_PRICING;
    /* v8 ignore stop */
  }
}

/** Initialize pricing.json if it doesn't exist */
export function initPricing(meterDir: string): void {
  const pricingPath = join(meterDir, "pricing.json");
  try {
    readFileSync(pricingPath);
  } catch {
    mkdirSync(dirname(pricingPath), { recursive: true });
    writeFileSync(pricingPath, JSON.stringify(DEFAULT_PRICING, null, 2) + "\n");
  }
}

/**
 * Find the highest outputPerMillion rate in the table (fallback for unknown models).
 * Returns the most expensive model pricing to overestimate rather than underestimate.
 */
export function getFallbackPricing(table: PricingTable): ModelPricing {
  let fallback: ModelPricing | undefined;
  let maxOutput = -1;
  for (const pricing of Object.values(table.models)) {
    if (pricing.outputPerMillion > maxOutput) {
      maxOutput = pricing.outputPerMillion;
      fallback = pricing;
    }
  }
  /* v8 ignore start -- empty pricing table fallback */
  return fallback ?? DEFAULT_PRICING.models["claude-opus-4-6"]!;
  /* v8 ignore stop */
}

/** Compute USD cost from token counts and pricing */
export function computeCost(
  pricing: ModelPricing,
  tokens: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
  },
): number {
  return (
    tokens.inputTokens * pricing.inputPerMillion +
    tokens.outputTokens * pricing.outputPerMillion +
    tokens.cacheCreationTokens * pricing.cacheCreationPerMillion +
    tokens.cacheReadTokens * pricing.cacheReadPerMillion
  ) / 1_000_000;
}

/** Resolve pricing for a model, falling back to most expensive if unknown */
export function resolvePricing(table: PricingTable, model: string): ModelPricing {
  return table.models[model] ?? getFallbackPricing(table);
}
