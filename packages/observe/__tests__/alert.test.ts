import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createAlertEngine } from "../src/alert.js";

describe("AlertEngine", () => {
  let alertsDir: string;

  beforeEach(() => {
    alertsDir = mkdtempSync(join(tmpdir(), "mecha-alerts-"));
  });

  it("adds and lists rules", () => {
    const engine = createAlertEngine(alertsDir);
    engine.addRule({ id: "cost-high", metric: "cost_per_run", threshold: 5.0, comparison: "gt", message: "Run cost exceeded $5" });
    expect(engine.rules()).toHaveLength(1);
    expect(engine.rules()[0]!.id).toBe("cost-high");
  });

  it("updates existing rule", () => {
    const engine = createAlertEngine(alertsDir);
    engine.addRule({ id: "cost-high", metric: "cost_per_run", threshold: 5.0, comparison: "gt", message: "v1" });
    engine.addRule({ id: "cost-high", metric: "cost_per_run", threshold: 10.0, comparison: "gt", message: "v2" });
    expect(engine.rules()).toHaveLength(1);
    expect(engine.rules()[0]!.threshold).toBe(10.0);
  });

  it("removes rules", () => {
    const engine = createAlertEngine(alertsDir);
    engine.addRule({ id: "r1", metric: "m", threshold: 1, comparison: "gt", message: "x" });
    expect(engine.removeRule("r1")).toBe(true);
    expect(engine.rules()).toHaveLength(0);
  });

  it("returns false for removing unknown rule", () => {
    const engine = createAlertEngine(alertsDir);
    expect(engine.removeRule("nope")).toBe(false);
  });

  it("fires alert when threshold exceeded (gt)", () => {
    const engine = createAlertEngine(alertsDir);
    engine.addRule({ id: "high-cost", metric: "cost", threshold: 5, comparison: "gt", message: "Cost too high" });

    const alerts = engine.evaluate("cost", 10);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.message).toBe("Cost too high");
    expect(alerts[0]!.value).toBe(10);
  });

  it("does not fire when value is under threshold", () => {
    const engine = createAlertEngine(alertsDir);
    engine.addRule({ id: "high-cost", metric: "cost", threshold: 5, comparison: "gt", message: "Cost too high" });
    expect(engine.evaluate("cost", 3)).toHaveLength(0);
  });

  it("supports lt comparison", () => {
    const engine = createAlertEngine(alertsDir);
    engine.addRule({ id: "low-quality", metric: "quality", threshold: 3, comparison: "lt", message: "Quality dropped" });
    expect(engine.evaluate("quality", 2)).toHaveLength(1);
    expect(engine.evaluate("quality", 4)).toHaveLength(0);
  });

  it("supports gte and lte", () => {
    const engine = createAlertEngine(alertsDir);
    engine.addRule({ id: "r1", metric: "m", threshold: 5, comparison: "gte", message: "gte" });
    engine.addRule({ id: "r2", metric: "m", threshold: 5, comparison: "lte", message: "lte" });

    const at5 = engine.evaluate("m", 5);
    expect(at5).toHaveLength(2); // both fire at exactly 5
  });

  it("persists fired alerts", () => {
    const engine = createAlertEngine(alertsDir);
    engine.addRule({ id: "r1", metric: "cost", threshold: 1, comparison: "gt", message: "high" });
    engine.evaluate("cost", 10);

    const fired = engine.fired();
    expect(fired).toHaveLength(1);
    expect(fired[0]!.ruleId).toBe("r1");
  });

  it("limits fired alerts", () => {
    const engine = createAlertEngine(alertsDir);
    engine.addRule({ id: "r1", metric: "cost", threshold: 0, comparison: "gt", message: "always" });
    for (let i = 0; i < 5; i++) engine.evaluate("cost", i + 1);
    expect(engine.fired(3)).toHaveLength(3);
  });

  it("returns empty when no alerts fired", () => {
    const engine = createAlertEngine(alertsDir);
    expect(engine.fired()).toEqual([]);
  });

  it("only evaluates matching metric", () => {
    const engine = createAlertEngine(alertsDir);
    engine.addRule({ id: "r1", metric: "cost", threshold: 1, comparison: "gt", message: "cost" });
    engine.addRule({ id: "r2", metric: "quality", threshold: 3, comparison: "lt", message: "quality" });
    expect(engine.evaluate("cost", 10)).toHaveLength(1);
    expect(engine.evaluate("quality", 2)).toHaveLength(1);
    expect(engine.evaluate("unknown", 999)).toHaveLength(0);
  });

  it("returns empty fired list when alerts file exists but is empty", () => {
    const engine = createAlertEngine(alertsDir);
    // Create an empty alerts.jsonl file
    writeFileSync(join(alertsDir, "alerts.jsonl"), "");
    expect(engine.fired()).toEqual([]);
  });

  it("returns empty fired list when alerts file has only whitespace", () => {
    const engine = createAlertEngine(alertsDir);
    writeFileSync(join(alertsDir, "alerts.jsonl"), "  \n  \n  ");
    expect(engine.fired()).toEqual([]);
  });

  it("does not fire for gt when value equals threshold", () => {
    const engine = createAlertEngine(alertsDir);
    engine.addRule({ id: "r1", metric: "cost", threshold: 5, comparison: "gt", message: "high" });
    expect(engine.evaluate("cost", 5)).toHaveLength(0);
  });

  it("does not fire for lt when value equals threshold", () => {
    const engine = createAlertEngine(alertsDir);
    engine.addRule({ id: "r1", metric: "cost", threshold: 5, comparison: "lt", message: "low" });
    expect(engine.evaluate("cost", 5)).toHaveLength(0);
  });
});
