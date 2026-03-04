import { describe, it, expect, vi, afterEach } from "vitest";
import { createProgram } from "../../src/program.js";
import { makeDeps } from "../test-utils.js";
import type { BatchResult } from "@mecha/service";

vi.mock("@mecha/service", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@mecha/service")>();
  return { ...orig, batchCasaAction: vi.fn() };
});

import { batchCasaAction } from "@mecha/service";
const mockBatch = vi.mocked(batchCasaAction);

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

describe("casa restart-all command", () => {
  it("restarts all CASAs", async () => {
    mockBatch.mockResolvedValue(successResult(["alice", "bob"]));
    const deps = makeDeps();
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "casa", "restart-all"]);
    expect(mockBatch).toHaveBeenCalledWith(expect.objectContaining({ action: "restart" }));
    expect(deps.formatter.info).toHaveBeenCalledWith(expect.stringContaining("Restarted 2"));
  });

  it("passes --force flag", async () => {
    mockBatch.mockResolvedValue(successResult(["alice"]));
    const deps = makeDeps();
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "casa", "restart-all", "--force"]);
    expect(mockBatch).toHaveBeenCalledWith(expect.objectContaining({ force: true }));
  });

  it("passes --idle-only flag", async () => {
    mockBatch.mockResolvedValue(successResult(["alice"]));
    const deps = makeDeps();
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "casa", "restart-all", "--idle-only"]);
    expect(mockBatch).toHaveBeenCalledWith(expect.objectContaining({ idleOnly: true }));
  });

  it("passes --dry-run and shows dry run message", async () => {
    mockBatch.mockResolvedValue(successResult(["alice"]));
    const deps = makeDeps();
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "casa", "restart-all", "--dry-run"]);
    expect(mockBatch).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true }));
    expect(deps.formatter.info).toHaveBeenCalledWith(expect.stringContaining("Dry run"));
  });

  it("sets exit code 1 on partial failure", async () => {
    mockBatch.mockResolvedValue({
      results: [
        { name: "alice", status: "succeeded" },
        { name: "bob", status: "failed", error: "config missing" },
      ],
      summary: { succeeded: 1, skipped: 0, failed: 1 },
    });
    const deps = makeDeps();
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "casa", "restart-all"]);
    expect(process.exitCode).toBe(1);
  });

  it("shows nothing-to-do when no CASAs", async () => {
    mockBatch.mockResolvedValue({ results: [], summary: { succeeded: 0, skipped: 0, failed: 0 } });
    const deps = makeDeps();
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "casa", "restart-all"]);
    expect(deps.formatter.info).toHaveBeenCalledWith(expect.stringContaining("No CASAs"));
  });

  it("outputs JSON when isJson formatter", async () => {
    const result = successResult(["alice"]);
    mockBatch.mockResolvedValue(result);
    const deps = makeDeps();
    Object.defineProperty(deps.formatter, "isJson", { value: true });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "casa", "restart-all"]);
    expect(deps.formatter.json).toHaveBeenCalledWith(result);
  });
});
