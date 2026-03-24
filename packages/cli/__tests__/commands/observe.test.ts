import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createProgram } from "../../src/program.js";
import { makeDeps } from "../test-utils.js";
import type { RunTrace, AlertRule } from "@mecha/observe";

/** Recent ISO timestamp for test data (1 hour ago, within --days 7 window). */
const RECENT = new Date(Date.now() - 3_600_000).toISOString();
const RECENT_PLUS_1 = new Date(Date.now() - 3_540_000).toISOString();
const RECENT_PLUS_30 = new Date(Date.now() - 1_800_000).toISOString();

function makeTrace(overrides: Partial<RunTrace> = {}): RunTrace {
  return {
    traceId: "run-001",
    workflow: "deploy",
    startedAt: RECENT,
    completedAt: RECENT_PLUS_1,
    status: "done",
    totalCostUsd: 0.05,
    steps: [
      {
        stepId: "step-1",
        bot: "builder",
        status: "completed",
        duration: "30.0s",
        startedAt: RECENT,
        completedAt: RECENT_PLUS_30,
        costUsd: 0.03,
      },
      {
        stepId: "step-2",
        bot: "deployer",
        status: "completed",
        duration: "30.0s",
        startedAt: RECENT_PLUS_30,
        completedAt: RECENT_PLUS_1,
        costUsd: 0.02,
      },
    ],
    ...overrides,
  };
}

function writeTrace(mechaDir: string, trace: RunTrace): void {
  const dir = join(mechaDir, "observe", "traces", trace.workflow);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${trace.traceId}.trace.json`),
    JSON.stringify(trace, null, 2) + "\n",
  );
}

function writeAlertRules(mechaDir: string, rules: AlertRule[]): void {
  const dir = join(mechaDir, "observe", "alerts");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "rules.json"), JSON.stringify(rules, null, 2) + "\n");
}

function writeFiredAlerts(mechaDir: string, alerts: { ruleId: string; value: number; message: string; firedAt: string }[]): void {
  const dir = join(mechaDir, "observe", "alerts");
  mkdirSync(dir, { recursive: true });
  const lines = alerts.map((a) => JSON.stringify(a)).join("\n") + "\n";
  writeFileSync(join(dir, "alerts.jsonl"), lines);
}

describe("trace commands", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    process.exitCode = undefined as unknown as number;
  });

  it("trace show displays a trace", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-trace-"));
    const trace = makeTrace();
    writeTrace(tempDir, trace);

    const deps = makeDeps({ mechaDir: tempDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "trace", "show", "deploy", "run-001"]);
    expect(deps.formatter.info).toHaveBeenCalledWith(
      expect.stringContaining("run-001"),
    );
    expect(deps.formatter.table).toHaveBeenCalledWith(
      ["Step", "Bot", "Status", "Duration", "Cost"],
      expect.any(Array),
    );
  });

  it("trace show reports not found", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-trace-"));
    const deps = makeDeps({ mechaDir: tempDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "trace", "show", "nope", "run-999"]);
    expect(deps.formatter.info).toHaveBeenCalledWith(
      expect.stringContaining("No trace found"),
    );
  });

  it("trace show outputs JSON when --json flag set", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-trace-"));
    const trace = makeTrace();
    writeTrace(tempDir, trace);

    const deps = makeDeps({ mechaDir: tempDir });
    (deps.formatter as any).isJson = true;
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "trace", "show", "deploy", "run-001"]);
    expect(deps.formatter.json).toHaveBeenCalledWith(
      expect.objectContaining({ traceId: "run-001" }),
    );
  });

  it("trace list shows traces for a workflow", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-trace-"));
    writeTrace(tempDir, makeTrace());
    writeTrace(tempDir, makeTrace({ traceId: "run-002" }));

    const deps = makeDeps({ mechaDir: tempDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "trace", "list", "deploy"]);
    expect(deps.formatter.table).toHaveBeenCalledWith(
      ["Run ID", "Status", "Started", "Cost"],
      expect.any(Array),
    );
  });

  it("trace list shows all workflows when no filter", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-trace-"));
    writeTrace(tempDir, makeTrace());
    writeTrace(tempDir, makeTrace({ traceId: "run-002", workflow: "test" }));

    const deps = makeDeps({ mechaDir: tempDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "trace", "list"]);
    expect(deps.formatter.table).toHaveBeenCalledWith(
      ["Workflow", "Run ID", "Status", "Started", "Cost"],
      expect.any(Array),
    );
  });

  it("trace list reports no traces", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-trace-"));
    const deps = makeDeps({ mechaDir: tempDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "trace", "list"]);
    expect(deps.formatter.info).toHaveBeenCalledWith("No traces found");
  });

  it("trace list outputs JSON for filtered workflow", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-trace-"));
    writeTrace(tempDir, makeTrace());

    const deps = makeDeps({ mechaDir: tempDir });
    (deps.formatter as any).isJson = true;
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "trace", "list", "deploy"]);
    expect(deps.formatter.json).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ traceId: "run-001" })]),
    );
  });

  it("trace list reports no traces for unknown workflow", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-trace-"));
    const deps = makeDeps({ mechaDir: tempDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "trace", "list", "nonexistent"]);
    expect(deps.formatter.info).toHaveBeenCalledWith(
      expect.stringContaining("No traces found"),
    );
  });

  it("trace list outputs JSON for all workflows", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-trace-"));
    writeTrace(tempDir, makeTrace());

    const deps = makeDeps({ mechaDir: tempDir });
    (deps.formatter as any).isJson = true;
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "trace", "list"]);
    expect(deps.formatter.json).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ traceId: "run-001" })]),
    );
  });
});

describe("metrics commands", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    process.exitCode = undefined as unknown as number;
  });

  it("metrics bot shows bot metrics", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-metrics-"));
    writeTrace(tempDir, makeTrace());

    const deps = makeDeps({ mechaDir: tempDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "metrics", "bot", "builder"]);
    expect(deps.formatter.info).toHaveBeenCalledWith(
      expect.stringContaining("Bot: builder"),
    );
    expect(deps.formatter.info).toHaveBeenCalledWith(
      expect.stringContaining("Success rate:"),
    );
  });

  it("metrics bot reports no data", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-metrics-"));
    const deps = makeDeps({ mechaDir: tempDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "metrics", "bot", "nobody"]);
    expect(deps.formatter.info).toHaveBeenCalledWith(
      expect.stringContaining("No metrics found"),
    );
  });

  it("metrics bot outputs JSON", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-metrics-"));
    writeTrace(tempDir, makeTrace());

    const deps = makeDeps({ mechaDir: tempDir });
    (deps.formatter as any).isJson = true;
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "metrics", "bot", "builder"]);
    expect(deps.formatter.json).toHaveBeenCalledWith(
      expect.objectContaining({ name: "builder", type: "bot" }),
    );
  });

  it("metrics workflow shows workflow metrics", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-metrics-"));
    writeTrace(tempDir, makeTrace());

    const deps = makeDeps({ mechaDir: tempDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "metrics", "workflow", "deploy"]);
    expect(deps.formatter.info).toHaveBeenCalledWith(
      expect.stringContaining("Workflow: deploy"),
    );
    expect(deps.formatter.info).toHaveBeenCalledWith(
      expect.stringContaining("Success rate:"),
    );
  });

  it("metrics workflow reports no data", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-metrics-"));
    const deps = makeDeps({ mechaDir: tempDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "metrics", "workflow", "nope"]);
    expect(deps.formatter.info).toHaveBeenCalledWith(
      expect.stringContaining("No metrics found"),
    );
  });

  it("metrics workflow outputs JSON", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-metrics-"));
    writeTrace(tempDir, makeTrace());

    const deps = makeDeps({ mechaDir: tempDir });
    (deps.formatter as any).isJson = true;
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "metrics", "workflow", "deploy"]);
    expect(deps.formatter.json).toHaveBeenCalledWith(
      expect.objectContaining({ name: "deploy", type: "workflow" }),
    );
  });
});

describe("workflow rate command", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    process.exitCode = undefined as unknown as number;
  });

  it("records a quality score", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-rate-"));
    const deps = makeDeps({ mechaDir: tempDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "workflow", "rate", "run-001", "4"]);
    expect(deps.formatter.success).toHaveBeenCalledWith(
      expect.stringContaining("Recorded score 4/5"),
    );
  });

  it("records a quality score with --workflow option", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-rate-"));
    const deps = makeDeps({ mechaDir: tempDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "workflow", "rate", "run-001", "5", "--workflow", "deploy"]);
    expect(deps.formatter.success).toHaveBeenCalledWith(
      expect.stringContaining("Recorded score 5/5"),
    );
  });

  it("rejects invalid score", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-rate-"));
    const deps = makeDeps({ mechaDir: tempDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "workflow", "rate", "run-001", "6"]);
    expect(deps.formatter.error).toHaveBeenCalledWith(
      expect.stringContaining("between 1 and 5"),
    );
    expect(process.exitCode).toBe(1);
  });

  it("rejects non-numeric score", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-rate-"));
    const deps = makeDeps({ mechaDir: tempDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "workflow", "rate", "run-001", "abc"]);
    expect(deps.formatter.error).toHaveBeenCalledWith(
      expect.stringContaining("between 1 and 5"),
    );
    expect(process.exitCode).toBe(1);
  });
});

describe("alert commands", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    process.exitCode = undefined as unknown as number;
  });

  it("alert list shows no fired alerts when empty", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-alert-"));
    const deps = makeDeps({ mechaDir: tempDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "alert", "list"]);
    expect(deps.formatter.info).toHaveBeenCalledWith("No fired alerts");
  });

  it("alert list shows fired alerts", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-alert-"));
    writeFiredAlerts(tempDir, [
      { ruleId: "high-cost", value: 1.5, message: "Cost exceeded $1", firedAt: "2025-01-01T00:00:00Z" },
    ]);

    const deps = makeDeps({ mechaDir: tempDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "alert", "list"]);
    expect(deps.formatter.table).toHaveBeenCalledWith(
      ["Rule", "Value", "Message", "Fired At"],
      expect.any(Array),
    );
  });

  it("alert list --rules shows rules", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-alert-"));
    writeAlertRules(tempDir, [
      { id: "high-cost", metric: "costUsd", threshold: 1, comparison: "gt", message: "Cost too high" },
    ]);

    const deps = makeDeps({ mechaDir: tempDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "alert", "list", "--rules"]);
    expect(deps.formatter.table).toHaveBeenCalledWith(
      ["ID", "Metric", "Comparison", "Threshold", "Message"],
      expect.any(Array),
    );
  });

  it("alert list --rules shows no rules when empty", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-alert-"));
    const deps = makeDeps({ mechaDir: tempDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "alert", "list", "--rules"]);
    expect(deps.formatter.info).toHaveBeenCalledWith("No alert rules configured");
  });

  it("alert list outputs JSON for fired alerts", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-alert-"));
    writeFiredAlerts(tempDir, [
      { ruleId: "high-cost", value: 1.5, message: "Cost exceeded $1", firedAt: "2025-01-01T00:00:00Z" },
    ]);

    const deps = makeDeps({ mechaDir: tempDir });
    (deps.formatter as any).isJson = true;
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "alert", "list"]);
    expect(deps.formatter.json).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ ruleId: "high-cost" })]),
    );
  });

  it("alert list --rules outputs JSON", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-alert-"));
    writeAlertRules(tempDir, [
      { id: "high-cost", metric: "costUsd", threshold: 1, comparison: "gt", message: "Cost too high" },
    ]);

    const deps = makeDeps({ mechaDir: tempDir });
    (deps.formatter as any).isJson = true;
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "alert", "list", "--rules"]);
    expect(deps.formatter.json).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: "high-cost" })]),
    );
  });

  it("alert add creates a rule", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-alert-"));
    const deps = makeDeps({ mechaDir: tempDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync([
      "node", "mecha", "alert", "add", "high-cost",
      "--metric", "costUsd",
      "--threshold", "1.0",
      "--comparison", "gt",
      "--message", "Cost exceeded $1",
    ]);
    expect(deps.formatter.success).toHaveBeenCalledWith(
      expect.stringContaining("high-cost"),
    );
  });

  it("alert add rejects invalid comparison", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-alert-"));
    const deps = makeDeps({ mechaDir: tempDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync([
      "node", "mecha", "alert", "add", "bad-rule",
      "--metric", "costUsd",
      "--threshold", "1.0",
      "--comparison", "invalid",
      "--message", "Test",
    ]);
    expect(deps.formatter.error).toHaveBeenCalledWith(
      expect.stringContaining("Invalid comparison"),
    );
    expect(process.exitCode).toBe(1);
  });

  it("alert add rejects non-numeric threshold", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-alert-"));
    const deps = makeDeps({ mechaDir: tempDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync([
      "node", "mecha", "alert", "add", "bad-rule",
      "--metric", "costUsd",
      "--threshold", "abc",
      "--comparison", "gt",
      "--message", "Test",
    ]);
    expect(deps.formatter.error).toHaveBeenCalledWith(
      expect.stringContaining("Threshold must be a number"),
    );
    expect(process.exitCode).toBe(1);
  });

  it("alert remove removes a rule", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-alert-"));
    writeAlertRules(tempDir, [
      { id: "high-cost", metric: "costUsd", threshold: 1, comparison: "gt", message: "Cost too high" },
    ]);

    const deps = makeDeps({ mechaDir: tempDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "alert", "remove", "high-cost"]);
    expect(deps.formatter.success).toHaveBeenCalledWith(
      expect.stringContaining("high-cost"),
    );
  });

  it("alert remove reports not found", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-alert-"));
    const deps = makeDeps({ mechaDir: tempDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "alert", "remove", "nonexistent"]);
    expect(deps.formatter.info).toHaveBeenCalledWith(
      expect.stringContaining("No alert rule found"),
    );
  });
});
