import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  readBudgets, writeBudgets, checkBudgets, setBudget, removeBudget,
} from "../src/budgets.js";
import type { BudgetConfig, CostSummary } from "../src/types.js";
import { emptySummary } from "../src/query.js";

function makeSummary(overrides: Partial<CostSummary> = {}): CostSummary {
  return { ...emptySummary(), ...overrides };
}

describe("budgets", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  describe("readBudgets / writeBudgets", () => {
    it("returns empty config for non-existent file", () => {
      tempDir = mkdtempSync(join(tmpdir(), "meter-budget-"));
      const config = readBudgets(tempDir);
      expect(config.global).toEqual({});
      expect(config.byCasa).toEqual({});
    });

    it("round-trips through write/read", () => {
      tempDir = mkdtempSync(join(tmpdir(), "meter-budget-"));
      const config: BudgetConfig = {
        global: { dailyUsd: 50 },
        byCasa: { researcher: { dailyUsd: 10, monthlyUsd: 100 } },
        byAuthProfile: {},
        byTag: {},
      };
      writeBudgets(tempDir, config);
      expect(existsSync(join(tempDir, "budgets.json"))).toBe(true);

      const read = readBudgets(tempDir);
      expect(read.global!.dailyUsd).toBe(50);
      expect(read.byCasa!["researcher"]!.dailyUsd).toBe(10);
    });
  });

  describe("checkBudgets", () => {
    it("allows when no limits configured", () => {
      const config: BudgetConfig = { global: {}, byCasa: {}, byAuthProfile: {}, byTag: {} };
      const result = checkBudgets(config, "researcher", "default", [], makeSummary(), makeSummary(), undefined, undefined, undefined, undefined, {});
      expect(result.allowed).toBe(true);
      expect(result.warnings).toEqual([]);
    });

    it("blocks when global daily limit exceeded", () => {
      const config: BudgetConfig = { global: { dailyUsd: 10 }, byCasa: {}, byAuthProfile: {}, byTag: {} };
      const today = makeSummary({ costUsd: 10.50 });
      const result = checkBudgets(config, "researcher", "default", [], today, makeSummary(), undefined, undefined, undefined, undefined, {});
      expect(result.allowed).toBe(false);
      expect(result.exceeded).toContain("exceeded daily limit");
    });

    it("warns at 80% of global daily limit", () => {
      const config: BudgetConfig = { global: { dailyUsd: 10 }, byCasa: {}, byAuthProfile: {}, byTag: {} };
      const today = makeSummary({ costUsd: 8.50 });
      const result = checkBudgets(config, "researcher", "default", [], today, makeSummary(), undefined, undefined, undefined, undefined, {});
      expect(result.allowed).toBe(true);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain("85%");
    });

    it("blocks when CASA daily limit exceeded", () => {
      const config: BudgetConfig = { global: {}, byCasa: { researcher: { dailyUsd: 5 } }, byAuthProfile: {}, byTag: {} };
      const casaToday = makeSummary({ costUsd: 5.10 });
      const result = checkBudgets(config, "researcher", "default", [], makeSummary(), makeSummary(), casaToday, undefined, undefined, undefined, {});
      expect(result.allowed).toBe(false);
      expect(result.exceeded).toContain("CASA researcher");
    });

    it("blocks when monthly limit exceeded", () => {
      const config: BudgetConfig = { global: { monthlyUsd: 100 }, byCasa: {}, byAuthProfile: {}, byTag: {} };
      const month = makeSummary({ costUsd: 105 });
      const result = checkBudgets(config, "researcher", "default", [], makeSummary(), month, undefined, undefined, undefined, undefined, {});
      expect(result.allowed).toBe(false);
      expect(result.exceeded).toContain("exceeded monthly limit");
    });

    it("warns at 80% of monthly limit", () => {
      const config: BudgetConfig = { global: { monthlyUsd: 100 }, byCasa: {}, byAuthProfile: {}, byTag: {} };
      const month = makeSummary({ costUsd: 85 });
      const result = checkBudgets(config, "researcher", "default", [], makeSummary(), month, undefined, undefined, undefined, undefined, {});
      expect(result.allowed).toBe(true);
      expect(result.warnings.some(w => w.includes("monthly"))).toBe(true);
    });

    it("checks auth profile limits", () => {
      const config: BudgetConfig = { global: {}, byCasa: {}, byAuthProfile: { work: { dailyUsd: 20 } }, byTag: {} };
      const authToday = makeSummary({ costUsd: 22 });
      const result = checkBudgets(config, "researcher", "work", [], makeSummary(), makeSummary(), undefined, undefined, authToday, undefined, {});
      expect(result.allowed).toBe(false);
      expect(result.exceeded).toContain("auth work");
    });

    it("checks tag limits", () => {
      const config: BudgetConfig = { global: {}, byCasa: {}, byAuthProfile: {}, byTag: { experiment: { dailyUsd: 3 } } };
      const tagSummary = makeSummary({ costUsd: 3.50 });
      const result = checkBudgets(config, "researcher", "default", ["experiment"], makeSummary(), makeSummary(), undefined, undefined, undefined, undefined, { experiment: tagSummary });
      expect(result.allowed).toBe(false);
      expect(result.exceeded).toContain("tag experiment");
    });

    it("uses todayCasa as month fallback when monthCasa undefined", () => {
      const config: BudgetConfig = { global: {}, byCasa: { r: { monthlyUsd: 10 } }, byAuthProfile: {}, byTag: {} };
      const casaToday = makeSummary({ costUsd: 11 });
      const result = checkBudgets(config, "r", "default", [], makeSummary(), makeSummary(), casaToday, undefined, undefined, undefined, {});
      expect(result.allowed).toBe(false);
      expect(result.exceeded).toContain("CASA r");
    });

    it("uses todayAuth as month fallback when monthAuth undefined", () => {
      const config: BudgetConfig = { global: {}, byCasa: {}, byAuthProfile: { w: { monthlyUsd: 10 } }, byTag: {} };
      const authToday = makeSummary({ costUsd: 11 });
      const result = checkBudgets(config, "r", "w", [], makeSummary(), makeSummary(), undefined, undefined, authToday, undefined, {});
      expect(result.allowed).toBe(false);
      expect(result.exceeded).toContain("auth w");
    });

    it("skips CASA check when byCasa is undefined", () => {
      const config = { global: {}, byAuthProfile: {}, byTag: {} } as BudgetConfig;
      const result = checkBudgets(config, "r", "default", [], makeSummary(), makeSummary(), undefined, undefined, undefined, undefined, {});
      expect(result.allowed).toBe(true);
    });

    it("skips auth check when byAuthProfile is undefined", () => {
      const config = { global: {}, byCasa: {}, byTag: {} } as BudgetConfig;
      const result = checkBudgets(config, "r", "default", [], makeSummary(), makeSummary(), undefined, undefined, undefined, undefined, {});
      expect(result.allowed).toBe(true);
    });

    it("skips tag check when byTag is undefined", () => {
      const config = { global: {}, byCasa: {}, byAuthProfile: {} } as BudgetConfig;
      const result = checkBudgets(config, "r", "default", ["x"], makeSummary(), makeSummary(), undefined, undefined, undefined, undefined, {});
      expect(result.allowed).toBe(true);
    });

    it("passes through when under all limits", () => {
      const config: BudgetConfig = {
        global: { dailyUsd: 50, monthlyUsd: 500 },
        byCasa: { researcher: { dailyUsd: 10 } },
        byAuthProfile: {},
        byTag: { exp: { dailyUsd: 20 } },
      };
      const globalToday = makeSummary({ costUsd: 5 });
      const globalMonth = makeSummary({ costUsd: 50 });
      const casaToday = makeSummary({ costUsd: 2 });
      const tagToday = makeSummary({ costUsd: 1 });
      const result = checkBudgets(config, "researcher", "default", ["exp"], globalToday, globalMonth, casaToday, undefined, undefined, undefined, { exp: tagToday });
      expect(result.allowed).toBe(true);
      expect(result.warnings).toEqual([]);
    });

    it("allows when auth profile is under limit", () => {
      const config: BudgetConfig = { global: {}, byCasa: {}, byAuthProfile: { w: { dailyUsd: 50 } }, byTag: {} };
      const authToday = makeSummary({ costUsd: 5 });
      const result = checkBudgets(config, "r", "w", [], makeSummary(), makeSummary(), undefined, undefined, authToday, undefined, {});
      expect(result.allowed).toBe(true);
      expect(result.warnings).toEqual([]);
    });

    it("skips global check when config.global is falsy", () => {
      const config = { byCasa: {}, byAuthProfile: {}, byTag: {} } as BudgetConfig;
      const result = checkBudgets(config, "r", "default", [], makeSummary(), makeSummary(), undefined, undefined, undefined, undefined, {});
      expect(result.allowed).toBe(true);
    });
  });

  describe("setBudget", () => {
    it("sets global budget", () => {
      const config: BudgetConfig = { global: {}, byCasa: {}, byAuthProfile: {}, byTag: {} };
      setBudget(config, { type: "global" }, 50, 500);
      expect(config.global!.dailyUsd).toBe(50);
      expect(config.global!.monthlyUsd).toBe(500);
    });

    it("sets CASA budget", () => {
      const config: BudgetConfig = { global: {}, byCasa: {}, byAuthProfile: {}, byTag: {} };
      setBudget(config, { type: "casa", name: "researcher" }, 10);
      expect(config.byCasa!["researcher"]!.dailyUsd).toBe(10);
    });

    it("sets auth budget", () => {
      const config: BudgetConfig = { global: {}, byAuthProfile: {}, byCasa: {}, byTag: {} };
      setBudget(config, { type: "auth", name: "work" }, undefined, 200);
      expect(config.byAuthProfile!["work"]!.monthlyUsd).toBe(200);
    });

    it("sets tag budget", () => {
      const config: BudgetConfig = { global: {}, byCasa: {}, byAuthProfile: {}, byTag: {} };
      setBudget(config, { type: "tag", name: "experiment" }, 5);
      expect(config.byTag!["experiment"]!.dailyUsd).toBe(5);
    });

    it("initializes missing map", () => {
      const config = { global: {} } as BudgetConfig;
      setBudget(config, { type: "casa", name: "test" }, 10);
      expect(config.byCasa!["test"]!.dailyUsd).toBe(10);
    });

    it("initializes missing byAuthProfile map", () => {
      const config = { global: {} } as BudgetConfig;
      setBudget(config, { type: "auth", name: "work" }, undefined, 200);
      expect(config.byAuthProfile!["work"]!.monthlyUsd).toBe(200);
    });

    it("initializes missing byTag map", () => {
      const config = { global: {} } as BudgetConfig;
      setBudget(config, { type: "tag", name: "exp" }, 5);
      expect(config.byTag!["exp"]!.dailyUsd).toBe(5);
    });
  });

  describe("removeBudget", () => {
    it("removes daily limit", () => {
      const config: BudgetConfig = { global: { dailyUsd: 50, monthlyUsd: 500 }, byCasa: {}, byAuthProfile: {}, byTag: {} };
      const removed = removeBudget(config, { type: "global" }, "daily");
      expect(removed).toBe(true);
      expect(config.global!.dailyUsd).toBeUndefined();
      expect(config.global!.monthlyUsd).toBe(500);
    });

    it("removes CASA monthly limit", () => {
      const config: BudgetConfig = { global: {}, byCasa: { researcher: { monthlyUsd: 100 } }, byAuthProfile: {}, byTag: {} };
      const removed = removeBudget(config, { type: "casa", name: "researcher" }, "monthly");
      expect(removed).toBe(true);
    });

    it("returns false for non-existent limit", () => {
      const config: BudgetConfig = { global: {}, byCasa: {}, byAuthProfile: {}, byTag: {} };
      expect(removeBudget(config, { type: "global" }, "daily")).toBe(false);
    });

    it("removes auth budget", () => {
      const config: BudgetConfig = { global: {}, byCasa: {}, byAuthProfile: { work: { dailyUsd: 20 } }, byTag: {} };
      expect(removeBudget(config, { type: "auth", name: "work" }, "daily")).toBe(true);
    });

    it("removes tag budget", () => {
      const config: BudgetConfig = { global: {}, byCasa: {}, byAuthProfile: {}, byTag: { exp: { dailyUsd: 5 } } };
      expect(removeBudget(config, { type: "tag", name: "exp" }, "daily")).toBe(true);
    });
  });
});
