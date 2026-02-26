import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createProgram } from "../../src/program.js";
import { makeDeps } from "../test-utils.js";

describe("budget command", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    process.exitCode = undefined as unknown as number;
  });

  describe("budget set", () => {
    it("sets a global daily budget", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-budget-"));
      const deps = makeDeps({ mechaDir: tempDir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "budget", "set", "--global", "--daily", "50"]);
      expect(deps.formatter.success).toHaveBeenCalledWith(expect.stringContaining("global"));

      const budgetsFile = join(tempDir, "meter", "budgets.json");
      expect(existsSync(budgetsFile)).toBe(true);
      const config = JSON.parse(readFileSync(budgetsFile, "utf-8"));
      expect(config.global.dailyUsd).toBe(50);
    });

    it("sets a CASA budget", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-budget-"));
      const deps = makeDeps({ mechaDir: tempDir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "budget", "set", "researcher", "--daily", "10", "--monthly", "100"]);
      expect(deps.formatter.success).toHaveBeenCalledWith(expect.stringContaining("researcher"));
    });

    it("sets auth budget", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-budget-"));
      const deps = makeDeps({ mechaDir: tempDir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "budget", "set", "--auth", "work", "--monthly", "200"]);
      expect(deps.formatter.success).toHaveBeenCalledWith(expect.stringContaining("work"));
    });

    it("sets tag budget", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-budget-"));
      const deps = makeDeps({ mechaDir: tempDir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "budget", "set", "--tag", "experiment", "--daily", "5"]);
      expect(deps.formatter.success).toHaveBeenCalledWith(expect.stringContaining("experiment"));
    });

    it("errors when no daily or monthly specified", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-budget-"));
      const deps = makeDeps({ mechaDir: tempDir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "budget", "set", "--global"]);
      expect(deps.formatter.error).toHaveBeenCalledWith(expect.stringContaining("--daily"));
    });

    it("errors when no target specified", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-budget-"));
      const deps = makeDeps({ mechaDir: tempDir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "budget", "set", "--daily", "10"]);
      expect(deps.formatter.error).toHaveBeenCalledWith(expect.stringContaining("CASA name"));
    });

    it("errors on non-numeric daily amount", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-budget-"));
      const deps = makeDeps({ mechaDir: tempDir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "budget", "set", "--global", "--daily", "abc"]);
      expect(deps.formatter.error).toHaveBeenCalledWith(expect.stringContaining("positive numbers"));
      expect(process.exitCode).toBe(1);
    });

    it("errors on negative monthly amount", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-budget-"));
      const deps = makeDeps({ mechaDir: tempDir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "budget", "set", "--global", "--monthly", "-5"]);
      expect(deps.formatter.error).toHaveBeenCalledWith(expect.stringContaining("positive numbers"));
      expect(process.exitCode).toBe(1);
    });

    it("errors on zero daily amount", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-budget-"));
      const deps = makeDeps({ mechaDir: tempDir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "budget", "set", "--global", "--daily", "0"]);
      expect(deps.formatter.error).toHaveBeenCalledWith(expect.stringContaining("positive numbers"));
      expect(process.exitCode).toBe(1);
    });
  });

  describe("budget rm", () => {
    it("removes a daily budget", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-budget-"));
      const meterDir = join(tempDir, "meter");
      mkdirSync(meterDir, { recursive: true });
      writeFileSync(join(meterDir, "budgets.json"), JSON.stringify({
        global: { dailyUsd: 50, monthlyUsd: 500 },
        byCasa: {}, byAuthProfile: {}, byTag: {},
      }));

      const deps = makeDeps({ mechaDir: tempDir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "budget", "rm", "--global", "--daily"]);
      expect(deps.formatter.success).toHaveBeenCalledWith(expect.stringContaining("Removed"));
    });

    it("warns when no limit found (global)", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-budget-"));
      const deps = makeDeps({ mechaDir: tempDir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "budget", "rm", "--global", "--daily"]);
      expect(deps.formatter.warn).toHaveBeenCalledWith(expect.stringContaining("No daily"));
    });

    it("warns when no limit found (CASA)", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-budget-"));
      const deps = makeDeps({ mechaDir: tempDir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "budget", "rm", "researcher", "--daily"]);
      expect(deps.formatter.warn).toHaveBeenCalledWith(expect.stringContaining("researcher"));
    });

    it("errors when no field specified", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-budget-"));
      const deps = makeDeps({ mechaDir: tempDir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "budget", "rm", "--global"]);
      expect(deps.formatter.error).toHaveBeenCalledWith(expect.stringContaining("--daily"));
    });

    it("errors when no target specified", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-budget-"));
      const deps = makeDeps({ mechaDir: tempDir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "budget", "rm", "--daily"]);
      expect(deps.formatter.error).toHaveBeenCalledWith(expect.stringContaining("CASA name"));
    });

    it("removes auth budget", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-budget-"));
      const meterDir = join(tempDir, "meter");
      mkdirSync(meterDir, { recursive: true });
      writeFileSync(join(meterDir, "budgets.json"), JSON.stringify({
        global: {}, byCasa: {}, byAuthProfile: { work: { dailyUsd: 20 } }, byTag: {},
      }));

      const deps = makeDeps({ mechaDir: tempDir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "budget", "rm", "--auth", "work", "--daily"]);
      expect(deps.formatter.success).toHaveBeenCalledWith(expect.stringContaining("Removed"));
    });

    it("removes tag budget", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-budget-"));
      const meterDir = join(tempDir, "meter");
      mkdirSync(meterDir, { recursive: true });
      writeFileSync(join(meterDir, "budgets.json"), JSON.stringify({
        global: {}, byCasa: {}, byAuthProfile: {}, byTag: { exp: { dailyUsd: 5 } },
      }));

      const deps = makeDeps({ mechaDir: tempDir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "budget", "rm", "--tag", "exp", "--daily"]);
      expect(deps.formatter.success).toHaveBeenCalledWith(expect.stringContaining("Removed"));
    });

    it("removes CASA budget by name", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-budget-"));
      const meterDir = join(tempDir, "meter");
      mkdirSync(meterDir, { recursive: true });
      writeFileSync(join(meterDir, "budgets.json"), JSON.stringify({
        global: {}, byCasa: { researcher: { dailyUsd: 10 } }, byAuthProfile: {}, byTag: {},
      }));

      const deps = makeDeps({ mechaDir: tempDir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "budget", "rm", "researcher", "--daily"]);
      expect(deps.formatter.success).toHaveBeenCalledWith(expect.stringContaining("Removed"));
    });

    it("removes monthly budget", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-budget-"));
      const meterDir = join(tempDir, "meter");
      mkdirSync(meterDir, { recursive: true });
      writeFileSync(join(meterDir, "budgets.json"), JSON.stringify({
        global: { monthlyUsd: 500 }, byCasa: {}, byAuthProfile: {}, byTag: {},
      }));

      const deps = makeDeps({ mechaDir: tempDir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "budget", "rm", "--global", "--monthly"]);
      expect(deps.formatter.success).toHaveBeenCalledWith(expect.stringContaining("Removed"));
    });
  });

  describe("budget ls", () => {
    it("shows no budgets when empty", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-budget-"));
      const deps = makeDeps({ mechaDir: tempDir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "budget", "ls"]);
      expect(deps.formatter.info).toHaveBeenCalledWith("No budgets configured");
    });

    it("lists configured budgets", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-budget-"));
      const meterDir = join(tempDir, "meter");
      mkdirSync(meterDir, { recursive: true });
      writeFileSync(join(meterDir, "budgets.json"), JSON.stringify({
        global: { dailyUsd: 50, monthlyUsd: 500 },
        byCasa: { researcher: { dailyUsd: 10, monthlyUsd: 100 } },
        byAuthProfile: { work: { monthlyUsd: 200 } },
        byTag: { experiment: { dailyUsd: 5 } },
      }));

      const deps = makeDeps({ mechaDir: tempDir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "budget", "ls"]);
      expect(deps.formatter.info).toHaveBeenCalledWith(expect.stringContaining("global"));
      expect(deps.formatter.info).toHaveBeenCalledWith(expect.stringContaining("researcher"));
      expect(deps.formatter.info).toHaveBeenCalledWith(expect.stringContaining("work"));
      expect(deps.formatter.info).toHaveBeenCalledWith(expect.stringContaining("experiment"));
    });

    it("lists global with only daily", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-budget-"));
      const meterDir = join(tempDir, "meter");
      mkdirSync(meterDir, { recursive: true });
      writeFileSync(join(meterDir, "budgets.json"), JSON.stringify({
        global: { dailyUsd: 50 },
        byCasa: {}, byAuthProfile: {}, byTag: {},
      }));

      const deps = makeDeps({ mechaDir: tempDir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "budget", "ls"]);
      expect(deps.formatter.info).toHaveBeenCalledWith(expect.stringContaining("daily"));
    });

    it("lists global with only monthly", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-budget-"));
      const meterDir = join(tempDir, "meter");
      mkdirSync(meterDir, { recursive: true });
      writeFileSync(join(meterDir, "budgets.json"), JSON.stringify({
        global: { monthlyUsd: 500 },
        byCasa: {}, byAuthProfile: {}, byTag: {},
      }));

      const deps = makeDeps({ mechaDir: tempDir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "budget", "ls"]);
      expect(deps.formatter.info).toHaveBeenCalledWith(expect.stringContaining("monthly"));
    });

    it("outputs JSON when flag set", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-budget-"));
      const deps = makeDeps({ mechaDir: tempDir });
      deps.formatter.isJson = true;
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "budget", "ls"]);
      expect(deps.formatter.json).toHaveBeenCalled();
    });
  });
});
