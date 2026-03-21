import { describe, it, expect, vi, afterEach } from "vitest";
import { createProgram } from "../../src/program.js";
import { makeDeps } from "../test-utils.js";
import type { ProcessInfo } from "@mecha/process";
import type { BotName } from "@mecha/core";
import type { BatchResult } from "@mecha/service";

vi.mock("@mecha/service", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@mecha/service")>();
  return { ...orig, batchBotAction: vi.fn() };
});

import { batchBotAction } from "@mecha/service";
const mockBatch = vi.mocked(batchBotAction);

const RUNNING: ProcessInfo = {
  name: "alice" as BotName, state: "running", pid: 1, port: 7700, workspacePath: "/ws",
};

afterEach(() => {
  process.exitCode = undefined as unknown as number;
  mockBatch.mockReset();
});

function successResult(names: string[]): BatchResult {
  return {
    results: names.map((n) => ({ name: n, status: "succeeded" as const })),
    summary: { succeeded: names.length, skipped: 0, failed: 0 },
  };
}

describe("bot stop-all command", () => {
  it("stops all running bots", async () => {
    mockBatch.mockResolvedValue(successResult(["alice", "bob"]));
    const deps = makeDeps({ pm: { list: vi.fn().mockReturnValue([RUNNING]) } });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "stop-all"]);
    expect(mockBatch).toHaveBeenCalledWith(expect.objectContaining({ action: "stop" }));
    expect(deps.formatter.table).toHaveBeenCalled();
    expect(deps.formatter.info).toHaveBeenCalledWith(expect.stringContaining("Stopped 2"));
  });

  it("passes --force flag", async () => {
    mockBatch.mockResolvedValue(successResult(["alice"]));
    const deps = makeDeps();
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "stop-all", "--force"]);
    expect(mockBatch).toHaveBeenCalledWith(expect.objectContaining({ force: true }));
  });

  it("passes --idle-only flag", async () => {
    mockBatch.mockResolvedValue(successResult(["alice"]));
    const deps = makeDeps();
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "stop-all", "--idle-only"]);
    expect(mockBatch).toHaveBeenCalledWith(expect.objectContaining({ idleOnly: true }));
  });

  it("passes --dry-run flag and shows info message", async () => {
    mockBatch.mockResolvedValue(successResult(["alice"]));
    const deps = makeDeps();
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "stop-all", "--dry-run"]);
    expect(mockBatch).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true }));
    expect(deps.formatter.info).toHaveBeenCalledWith(expect.stringContaining("Dry run"));
  });

  it("sets exit code 1 on partial failure", async () => {
    mockBatch.mockResolvedValue({
      results: [
        { name: "alice", status: "succeeded" },
        { name: "bob", status: "failed", error: "timeout" },
      ],
      summary: { succeeded: 1, skipped: 0, failed: 1 },
    });
    const deps = makeDeps();
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "stop-all"]);
    expect(process.exitCode).toBe(1);
  });

  it("shows nothing-to-do when no bots", async () => {
    mockBatch.mockResolvedValue({ results: [], summary: { succeeded: 0, skipped: 0, failed: 0 } });
    const deps = makeDeps();
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "stop-all"]);
    expect(deps.formatter.info).toHaveBeenCalledWith(expect.stringContaining("No bots"));
    expect(deps.formatter.table).not.toHaveBeenCalled();
  });

  it("outputs JSON with --json via isJson formatter", async () => {
    const result = successResult(["alice"]);
    mockBatch.mockResolvedValue(result);
    const deps = makeDeps();
    Object.defineProperty(deps.formatter, "isJson", { value: true });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "stop-all"]);
    expect(deps.formatter.json).toHaveBeenCalledWith(result);
    expect(deps.formatter.table).not.toHaveBeenCalled();
  });
});
