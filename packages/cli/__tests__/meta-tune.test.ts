import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createProgram } from "../src/program.js";
import { makeDeps } from "./test-utils.js";
import type { CommandDeps } from "../src/types.js";

describe("meta tune command", () => {
  let deps: CommandDeps;
  let mechaDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-meta-tune-"));
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

  function writeScores(scores: Array<Record<string, unknown>>): void {
    const dir = join(mechaDir, "observe", "scores");
    mkdirSync(dir, { recursive: true });
    const lines = scores.map((s) => JSON.stringify(s)).join("\n") + "\n";
    writeFileSync(join(dir, "scores.jsonl"), lines);
  }

  it("registers the tune subcommand", () => {
    const program = createProgram(deps);
    const metaCmd = program.commands.find((c) => c.name() === "meta");
    expect(metaCmd).toBeDefined();
    const tuneCmd = metaCmd!.commands.find((c) => c.name() === "tune");
    expect(tuneCmd).toBeDefined();
    expect(tuneCmd!.description()).toContain("tuning");
  });

  it("shows message when no quality scores exist", async () => {
    await run(["meta", "tune"]);

    expect(deps.formatter.info).toHaveBeenCalledWith(
      "No quality scores found. Score some runs first.",
    );
  });

  it("shows message when specific bot has no scores", async () => {
    await run(["meta", "tune", "ghost"]);

    expect(deps.formatter.info).toHaveBeenCalledWith(
      'No quality scores found for bot "ghost"',
    );
  });

  it("shows analysis for a specific bot with scores", async () => {
    writeScores([
      { runId: "r1", bot: "alice", score: 3.0, source: "human", scoredAt: "2026-03-01T00:00:00Z" },
      { runId: "r2", bot: "alice", score: 4.5, source: "human", scoredAt: "2026-03-02T00:00:00Z" },
      { runId: "r3", bot: "alice", score: 4.8, source: "human", scoredAt: "2026-03-03T00:00:00Z" },
      { runId: "r4", bot: "alice", score: 5.0, source: "human", scoredAt: "2026-03-04T00:00:00Z" },
    ]);

    await run(["meta", "tune", "alice"]);

    const calls = (deps.formatter.info as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0] as string);
    expect(calls).toContainEqual("Bot: alice");
    expect(calls).toContainEqual(expect.stringContaining("Trend:"));
    expect(calls).toContainEqual(expect.stringContaining("Avg score:"));
    expect(calls).toContainEqual(expect.stringContaining("Scores:"));
    expect(calls).toContainEqual(expect.stringContaining("Recommendation:"));
  });

  it("shows analysis for all bots when no bot specified", async () => {
    writeScores([
      { runId: "r1", bot: "alice", score: 4.0, source: "human", scoredAt: "2026-03-01T00:00:00Z" },
      { runId: "r2", bot: "alice", score: 4.2, source: "human", scoredAt: "2026-03-02T00:00:00Z" },
      { runId: "r3", bot: "bob", score: 3.5, source: "human", scoredAt: "2026-03-01T00:00:00Z" },
      { runId: "r4", bot: "bob", score: 3.0, source: "human", scoredAt: "2026-03-02T00:00:00Z" },
    ]);

    await run(["meta", "tune"]);

    const calls = (deps.formatter.info as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0] as string);
    expect(calls).toContainEqual("Tuning Recommendations");
    expect(calls).toContainEqual("Bot: alice");
    expect(calls).toContainEqual("Bot: bob");
  });

  it("shows improving trend for increasing scores", async () => {
    writeScores([
      { runId: "r1", bot: "coder", score: 2.0, source: "human", scoredAt: "2026-03-01T00:00:00Z" },
      { runId: "r2", bot: "coder", score: 2.5, source: "human", scoredAt: "2026-03-02T00:00:00Z" },
      { runId: "r3", bot: "coder", score: 4.0, source: "human", scoredAt: "2026-03-03T00:00:00Z" },
      { runId: "r4", bot: "coder", score: 4.5, source: "human", scoredAt: "2026-03-04T00:00:00Z" },
    ]);

    await run(["meta", "tune", "coder"]);

    const calls = (deps.formatter.info as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0] as string);
    expect(calls).toContainEqual("  Trend: improving");
  });

  it("shows declining trend for decreasing scores", async () => {
    writeScores([
      { runId: "r1", bot: "writer", score: 4.5, source: "human", scoredAt: "2026-03-01T00:00:00Z" },
      { runId: "r2", bot: "writer", score: 4.0, source: "human", scoredAt: "2026-03-02T00:00:00Z" },
      { runId: "r3", bot: "writer", score: 2.5, source: "human", scoredAt: "2026-03-03T00:00:00Z" },
      { runId: "r4", bot: "writer", score: 2.0, source: "human", scoredAt: "2026-03-04T00:00:00Z" },
    ]);

    await run(["meta", "tune", "writer"]);

    const calls = (deps.formatter.info as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0] as string);
    expect(calls).toContainEqual("  Trend: declining");
  });

  it("skips scores without a bot field", async () => {
    writeScores([
      { runId: "r1", score: 4.0, source: "automated", scoredAt: "2026-03-01T00:00:00Z" },
    ]);

    await run(["meta", "tune"]);

    expect(deps.formatter.info).toHaveBeenCalledWith(
      "No quality scores found. Score some runs first.",
    );
  });
});
