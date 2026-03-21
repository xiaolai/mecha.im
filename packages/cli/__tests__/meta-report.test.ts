import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createProgram } from "../src/program.js";
import { makeDeps } from "./test-utils.js";
import type { CommandDeps } from "../src/types.js";

describe("meta report command", () => {
  let deps: CommandDeps;
  let mechaDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-meta-report-"));
    deps = makeDeps({ mechaDir });
  });

  afterEach(() => {
    rmSync(mechaDir, { recursive: true, force: true });
  });

  function run(args: string[]) {
    const program = createProgram(deps);
    program.exitOverride();
    program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
    return program.parseAsync(["node", "mecha", ...args]);
  }

  function writeTrace(workflow: string, traceId: string, trace: Record<string, unknown>): void {
    const dir = join(mechaDir, "observe", "traces", workflow);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${traceId}.trace.json`), JSON.stringify(trace));
  }

  it("registers the report subcommand", () => {
    const program = createProgram(deps);
    const metaCmd = program.commands.find((c) => c.name() === "meta");
    expect(metaCmd).toBeDefined();
    const reportCmd = metaCmd!.commands.find((c) => c.name() === "report");
    expect(reportCmd).toBeDefined();
    expect(reportCmd!.description()).toContain("report");
  });

  it("shows info message when no workflow activity exists", async () => {
    await run(["meta", "report"]);

    expect(deps.formatter.info).toHaveBeenCalledWith("No workflow activity to report");
  });

  it("shows report with workflow traces", async () => {
    const now = new Date().toISOString();
    writeTrace("deploy", "run-1", {
      traceId: "run-1",
      workflow: "deploy",
      startedAt: now,
      completedAt: now,
      status: "done",
      totalCostUsd: 1.50,
      steps: [],
    });

    await run(["meta", "report"]);

    const calls = (deps.formatter.info as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0] as string);
    expect(calls).toContainEqual(expect.stringContaining("Company Report"));
    expect(calls).toContainEqual(expect.stringContaining("deploy:"));
    expect(calls).toContainEqual(expect.stringContaining("Runs: 1"));
    expect(calls).toContainEqual(expect.stringContaining("Total: 1 runs"));
  });

  it("respects --days flag to filter recent traces", async () => {
    // Write a trace from 30 days ago
    const oldDate = new Date(Date.now() - 30 * 86400000).toISOString();
    writeTrace("old-wf", "run-old", {
      traceId: "run-old",
      workflow: "old-wf",
      startedAt: oldDate,
      completedAt: oldDate,
      status: "done",
      totalCostUsd: 2.00,
      steps: [],
    });

    // Report for last 3 days should skip old trace
    await run(["meta", "report", "--days", "3"]);

    const calls = (deps.formatter.info as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0] as string);
    expect(calls).toContainEqual(expect.stringContaining("Company Report (last 3 days)"));
    // The old workflow should not appear in the output (skipped because no recent traces)
    expect(calls).toContainEqual(expect.stringContaining("Total: 0 runs"));
  });

  it("shows quality score when available", async () => {
    const now = new Date().toISOString();
    writeTrace("qa-wf", "run-q1", {
      traceId: "run-q1",
      workflow: "qa-wf",
      startedAt: now,
      completedAt: now,
      status: "done",
      totalCostUsd: 0.50,
      qualityScore: 4.2,
      steps: [],
    });

    await run(["meta", "report"]);

    const calls = (deps.formatter.info as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0] as string);
    expect(calls).toContainEqual(expect.stringContaining("qa-wf:"));
  });

  it("defaults to 7 days when --days is not a number", async () => {
    const now = new Date().toISOString();
    writeTrace("test-wf", "run-1", {
      traceId: "run-1",
      workflow: "test-wf",
      startedAt: now,
      completedAt: now,
      status: "done",
      totalCostUsd: 1.00,
      steps: [],
    });

    await run(["meta", "report", "--days", "invalid"]);

    const calls = (deps.formatter.info as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0] as string);
    expect(calls).toContainEqual(expect.stringContaining("Company Report (last 7 days)"));
  });
});
