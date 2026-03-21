import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
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

function emptyConfig(): BudgetConfig {
  return { global: {}, byBot: {}, byAuthProfile: {}, byTag: {} };
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
      expect(config.byBot).toEqual({});
      expect(config.byAuthProfile).toEqual({});
      expect(config.byTag).toEqual({});
    });

    it("normalizes partial JSON (missing fields default to empty)", () => {
      tempDir = mkdtempSync(join(tmpdir(), "meter-budget-"));
      const { writeFileSync: wf } = require("node:fs");
      wf(join(tempDir, "budgets.json"), JSON.stringify({}));

      const config = readBudgets(tempDir);
      expect(config.global).toEqual({});
      expect(config.byBot).toEqual({});
      expect(config.byAuthProfile).toEqual({});
      expect(config.byTag).toEqual({});
    });

    it("round-trips through write/read", () => {
      tempDir = mkdtempSync(join(tmpdir(), "meter-budget-"));
      const config: BudgetConfig = {
        global: { dailyUsd: 50 },
        byBot: { researcher: { dailyUsd: 10, monthlyUsd: 100 } },
        byAuthProfile: {},
        byTag: {},
      };
      writeBudgets(tempDir, config);
      expect(existsSync(join(tempDir, "budgets.json"))).toBe(true);

      const read = readBudgets(tempDir);
      expect(read.global.dailyUsd).toBe(50);
      expect(read.byBot["researcher"]!.dailyUsd).toBe(10);
    });
  });

  describe("checkBudgets", () => {
    it("allows when no limits configured", () => {
      const result = checkBudgets({
        config: emptyConfig(),
        bot: "researcher", authProfile: "default", tags: [],
        global: { today: makeSummary(), month: makeSummary() },
        perTag: {},
      });
      expect(result.allowed).toBe(true);
      expect(result.warnings).toEqual([]);
    });

    it("blocks when global daily limit exceeded", () => {
      const result = checkBudgets({
        config: { ...emptyConfig(), global: { dailyUsd: 10 } },
        bot: "researcher", authProfile: "default", tags: [],
        global: { today: makeSummary({ costUsd: 10.50 }), month: makeSummary() },
        perTag: {},
      });
      expect(result.allowed).toBe(false);
      expect(result.exceeded).toContain("exceeded daily limit");
    });

    it("warns at 80% of global daily limit", () => {
      const result = checkBudgets({
        config: { ...emptyConfig(), global: { dailyUsd: 10 } },
        bot: "researcher", authProfile: "default", tags: [],
        global: { today: makeSummary({ costUsd: 8.50 }), month: makeSummary() },
        perTag: {},
      });
      expect(result.allowed).toBe(true);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain("85%");
    });

    it("blocks when bot daily limit exceeded", () => {
      const result = checkBudgets({
        config: { ...emptyConfig(), byBot: { researcher: { dailyUsd: 5 } } },
        bot: "researcher", authProfile: "default", tags: [],
        global: { today: makeSummary(), month: makeSummary() },
        perBot: { today: makeSummary({ costUsd: 5.10 }), month: makeSummary() },
        perTag: {},
      });
      expect(result.allowed).toBe(false);
      expect(result.exceeded).toContain("bot researcher");
    });

    it("blocks when monthly limit exceeded", () => {
      const result = checkBudgets({
        config: { ...emptyConfig(), global: { monthlyUsd: 100 } },
        bot: "researcher", authProfile: "default", tags: [],
        global: { today: makeSummary(), month: makeSummary({ costUsd: 105 }) },
        perTag: {},
      });
      expect(result.allowed).toBe(false);
      expect(result.exceeded).toContain("exceeded monthly limit");
    });

    it("warns at 80% of monthly limit", () => {
      const result = checkBudgets({
        config: { ...emptyConfig(), global: { monthlyUsd: 100 } },
        bot: "researcher", authProfile: "default", tags: [],
        global: { today: makeSummary(), month: makeSummary({ costUsd: 85 }) },
        perTag: {},
      });
      expect(result.allowed).toBe(true);
      expect(result.warnings.some(w => w.includes("monthly"))).toBe(true);
    });

    it("checks auth profile limits", () => {
      const result = checkBudgets({
        config: { ...emptyConfig(), byAuthProfile: { work: { dailyUsd: 20 } } },
        bot: "researcher", authProfile: "work", tags: [],
        global: { today: makeSummary(), month: makeSummary() },
        perAuth: { today: makeSummary({ costUsd: 22 }), month: makeSummary() },
        perTag: {},
      });
      expect(result.allowed).toBe(false);
      expect(result.exceeded).toContain("auth work");
    });

    it("checks tag limits", () => {
      const result = checkBudgets({
        config: { ...emptyConfig(), byTag: { experiment: { dailyUsd: 3 } } },
        bot: "researcher", authProfile: "default", tags: ["experiment"],
        global: { today: makeSummary(), month: makeSummary() },
        perTag: { experiment: { today: makeSummary({ costUsd: 3.50 }), month: makeSummary({ costUsd: 3.50 }) } },
      });
      expect(result.allowed).toBe(false);
      expect(result.exceeded).toContain("tag experiment");
    });

    it("skips bot check when no perBot provided", () => {
      const result = checkBudgets({
        config: { ...emptyConfig(), byBot: { r: { dailyUsd: 5 } } },
        bot: "r", authProfile: "default", tags: [],
        global: { today: makeSummary(), month: makeSummary() },
        perTag: {},
      });
      expect(result.allowed).toBe(true);
    });

    it("skips auth check when no perAuth provided", () => {
      const result = checkBudgets({
        config: { ...emptyConfig(), byAuthProfile: { w: { dailyUsd: 20 } } },
        bot: "r", authProfile: "w", tags: [],
        global: { today: makeSummary(), month: makeSummary() },
        perTag: {},
      });
      expect(result.allowed).toBe(true);
    });

    it("skips tag check when tag summary is missing", () => {
      const result = checkBudgets({
        config: { ...emptyConfig(), byTag: { x: { dailyUsd: 5 } } },
        bot: "r", authProfile: "default", tags: ["x"],
        global: { today: makeSummary(), month: makeSummary() },
        perTag: {},
      });
      expect(result.allowed).toBe(true);
    });

    it("passes through when under all limits", () => {
      const result = checkBudgets({
        config: {
          global: { dailyUsd: 50, monthlyUsd: 500 },
          byBot: { researcher: { dailyUsd: 10 } },
          byAuthProfile: {},
          byTag: { exp: { dailyUsd: 20 } },
        },
        bot: "researcher", authProfile: "default", tags: ["exp"],
        global: { today: makeSummary({ costUsd: 5 }), month: makeSummary({ costUsd: 50 }) },
        perBot: { today: makeSummary({ costUsd: 2 }), month: makeSummary({ costUsd: 2 }) },
        perTag: { exp: { today: makeSummary({ costUsd: 1 }), month: makeSummary({ costUsd: 1 }) } },
      });
      expect(result.allowed).toBe(true);
      expect(result.warnings).toEqual([]);
    });

    it("allows when auth profile is under limit", () => {
      const result = checkBudgets({
        config: { ...emptyConfig(), byAuthProfile: { w: { dailyUsd: 50 } } },
        bot: "r", authProfile: "w", tags: [],
        global: { today: makeSummary(), month: makeSummary() },
        perAuth: { today: makeSummary({ costUsd: 5 }), month: makeSummary() },
        perTag: {},
      });
      expect(result.allowed).toBe(true);
      expect(result.warnings).toEqual([]);
    });

    it("blocks when bot monthly limit exceeded via perBot month", () => {
      const result = checkBudgets({
        config: { ...emptyConfig(), byBot: { r: { monthlyUsd: 10 } } },
        bot: "r", authProfile: "default", tags: [],
        global: { today: makeSummary(), month: makeSummary() },
        perBot: { today: makeSummary(), month: makeSummary({ costUsd: 11 }) },
        perTag: {},
      });
      expect(result.allowed).toBe(false);
      expect(result.exceeded).toContain("bot r");
    });

    it("blocks when auth monthly limit exceeded via perAuth month", () => {
      const result = checkBudgets({
        config: { ...emptyConfig(), byAuthProfile: { w: { monthlyUsd: 10 } } },
        bot: "r", authProfile: "w", tags: [],
        global: { today: makeSummary(), month: makeSummary() },
        perAuth: { today: makeSummary(), month: makeSummary({ costUsd: 11 }) },
        perTag: {},
      });
      expect(result.allowed).toBe(false);
      expect(result.exceeded).toContain("auth w");
    });

    it("warns at 80% of bot daily limit", () => {
      const result = checkBudgets({
        config: { ...emptyConfig(), byBot: { r: { dailyUsd: 10 } } },
        bot: "r", authProfile: "default", tags: [],
        global: { today: makeSummary(), month: makeSummary() },
        perBot: { today: makeSummary({ costUsd: 8.5 }), month: makeSummary() },
        perTag: {},
      });
      expect(result.allowed).toBe(true);
      expect(result.warnings.some(w => w.includes("bot r") && w.includes("daily"))).toBe(true);
    });

    it("blocks when global daily-only limit is exceeded (no monthlyUsd)", () => {
      const result = checkBudgets({
        config: { ...emptyConfig(), global: { dailyUsd: 5 } },
        bot: "r", authProfile: "default", tags: [],
        global: { today: makeSummary({ costUsd: 6 }), month: makeSummary() },
        perTag: {},
      });
      expect(result.allowed).toBe(false);
      expect(result.exceeded).toContain("daily");
    });
  });

  describe("setBudget", () => {
    it("sets global budget", () => {
      const config = emptyConfig();
      setBudget(config, { type: "global" }, 50, 500);
      expect(config.global.dailyUsd).toBe(50);
      expect(config.global.monthlyUsd).toBe(500);
    });

    it("sets bot budget", () => {
      const config = emptyConfig();
      setBudget(config, { type: "bot", name: "researcher" }, 10);
      expect(config.byBot["researcher"]!.dailyUsd).toBe(10);
    });

    it("sets auth budget", () => {
      const config = emptyConfig();
      setBudget(config, { type: "auth", name: "work" }, undefined, 200);
      expect(config.byAuthProfile["work"]!.monthlyUsd).toBe(200);
    });

    it("sets tag budget", () => {
      const config = emptyConfig();
      setBudget(config, { type: "tag", name: "experiment" }, 5);
      expect(config.byTag["experiment"]!.dailyUsd).toBe(5);
    });

    it("merges with existing budget", () => {
      const config = emptyConfig();
      setBudget(config, { type: "bot", name: "test" }, 10);
      setBudget(config, { type: "bot", name: "test" }, undefined, 100);
      expect(config.byBot["test"]!.dailyUsd).toBe(10);
      expect(config.byBot["test"]!.monthlyUsd).toBe(100);
    });
  });

  describe("removeBudget", () => {
    it("removes daily limit", () => {
      const config: BudgetConfig = { global: { dailyUsd: 50, monthlyUsd: 500 }, byBot: {}, byAuthProfile: {}, byTag: {} };
      const removed = removeBudget(config, { type: "global" }, "daily");
      expect(removed).toBe(true);
      expect(config.global.dailyUsd).toBeUndefined();
      expect(config.global.monthlyUsd).toBe(500);
    });

    it("removes bot monthly limit", () => {
      const config: BudgetConfig = { global: {}, byBot: { researcher: { monthlyUsd: 100 } }, byAuthProfile: {}, byTag: {} };
      const removed = removeBudget(config, { type: "bot", name: "researcher" }, "monthly");
      expect(removed).toBe(true);
    });

    it("returns false for non-existent limit", () => {
      const config = emptyConfig();
      expect(removeBudget(config, { type: "global" }, "daily")).toBe(false);
    });

    it("removes auth budget", () => {
      const config: BudgetConfig = { global: {}, byBot: {}, byAuthProfile: { work: { dailyUsd: 20 } }, byTag: {} };
      expect(removeBudget(config, { type: "auth", name: "work" }, "daily")).toBe(true);
    });

    it("removes tag budget", () => {
      const config: BudgetConfig = { global: {}, byBot: {}, byAuthProfile: {}, byTag: { exp: { dailyUsd: 5 } } };
      expect(removeBudget(config, { type: "tag", name: "exp" }, "daily")).toBe(true);
    });

    it("returns false for non-existent bot entry", () => {
      const config = emptyConfig();
      expect(removeBudget(config, { type: "bot", name: "nope" }, "daily")).toBe(false);
    });
  });
});
