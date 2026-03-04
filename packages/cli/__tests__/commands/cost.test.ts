import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createProgram } from "../../src/program.js";
import { makeDeps } from "../test-utils.js";
import type { MeterEvent } from "@mecha/meter";

function makeEvent(overrides: Partial<MeterEvent> = {}): MeterEvent {
  return {
    id: "01TEST",
    ts: new Date().toISOString(),
    bot: "researcher",
    authProfile: "default",
    workspace: "/ws",
    tags: ["research"],
    model: "claude-sonnet-4-6",
    stream: true,
    status: 200,
    modelActual: "claude-sonnet-4-6",
    latencyMs: 500,
    ttftMs: 50,
    inputTokens: 100,
    outputTokens: 50,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    costUsd: 0.05,
    ...overrides,
  };
}

function writeEvents(meterDir: string, events: MeterEvent[]): void {
  const date = new Date().toISOString().slice(0, 10);
  const eventsDir = join(meterDir, "meter", "events");
  mkdirSync(eventsDir, { recursive: true });
  const lines = events.map(e => JSON.stringify(e)).join("\n") + "\n";
  writeFileSync(join(eventsDir, `${date}.jsonl`), lines);
}

describe("cost command", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    process.exitCode = undefined as unknown as number;
  });

  it("shows no activity when no events", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-cost-"));
    const deps = makeDeps({ mechaDir: tempDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "cost"]);
    expect(deps.formatter.info).toHaveBeenCalledWith(
      expect.stringContaining("No API activity"),
    );
  });

  it("shows cost summary with events", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-cost-"));
    writeEvents(tempDir, [
      makeEvent({ id: "A", bot: "researcher", costUsd: 0.10 }),
      makeEvent({ id: "B", bot: "coder", costUsd: 0.05 }),
    ]);

    const deps = makeDeps({ mechaDir: tempDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "cost"]);
    expect(deps.formatter.info).toHaveBeenCalledWith(
      expect.stringContaining("$0.15"),
    );
    // Should show per-bot breakdown
    expect(deps.formatter.info).toHaveBeenCalledWith(
      expect.stringContaining("researcher"),
    );
  });

  it("filters by bot name", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-cost-"));
    writeEvents(tempDir, [
      makeEvent({ id: "A", bot: "researcher", costUsd: 0.10 }),
      makeEvent({ id: "B", bot: "coder", costUsd: 0.05 }),
    ]);

    const deps = makeDeps({ mechaDir: tempDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "cost", "researcher"]);
    expect(deps.formatter.info).toHaveBeenCalledWith(
      expect.stringContaining("$0.10"),
    );
  });

  it("outputs JSON when --json flag set", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-cost-"));
    writeEvents(tempDir, [
      makeEvent({ id: "A", costUsd: 0.10 }),
    ]);

    const deps = makeDeps({ mechaDir: tempDir });
    deps.formatter.isJson = true;
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "cost"]);
    expect(deps.formatter.json).toHaveBeenCalledWith(
      expect.objectContaining({
        total: expect.objectContaining({ requests: 1 }),
      }),
    );
  });

  it("does not show breakdown for single bot query", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-cost-"));
    writeEvents(tempDir, [
      makeEvent({ id: "A", bot: "researcher", costUsd: 0.10 }),
    ]);

    const deps = makeDeps({ mechaDir: tempDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "cost", "researcher"]);
    // The separator line should not appear for single bot query
    const infoCalls = (deps.formatter.info as unknown as { mock: { calls: string[][] } }).mock.calls;
    const hasSeparator = infoCalls.some((args: string[]) => args[0]?.includes("─"));
    expect(hasSeparator).toBe(false);
  });
});
