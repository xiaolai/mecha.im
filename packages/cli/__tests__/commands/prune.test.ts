import { describe, it, expect, vi, beforeEach } from "vitest";
import { Command } from "commander";
import type { CommandDeps } from "../../src/types.js";
import type { Formatter } from "../../src/output/formatter.js";
import { registerPruneCommand } from "../../src/commands/prune.js";

const mockMechaPrune = vi.fn();
const mockMechaLs = vi.fn();

vi.mock("@mecha/service", () => ({
  mechaPrune: (...args: unknown[]) => mockMechaPrune(...args),
  mechaLs: (...args: unknown[]) => mockMechaLs(...args),
}));

let readlineAnswer = "y";
vi.mock("node:readline", () => ({
  createInterface: () => ({
    question: (_msg: string, cb: (answer: string) => void) => cb(readlineAnswer),
    close: vi.fn(),
  }),
}));

function createMockFormatter(): Formatter {
  return { info: vi.fn(), error: vi.fn(), success: vi.fn(), json: vi.fn(), table: vi.fn() };
}

describe("mecha prune", () => {
  let formatter: Formatter;
  let deps: CommandDeps;

  beforeEach(() => {
    formatter = createMockFormatter();
    deps = { processManager: {} as any, formatter };
    process.exitCode = undefined;
    vi.clearAllMocks();
    readlineAnswer = "y";
  });

  it("removes stopped processes with --force", async () => {
    mockMechaPrune.mockResolvedValueOnce({ removedProcesses: ["mx-a", "mx-b"] });
    const program = new Command();
    registerPruneCommand(program, deps);
    await program.parseAsync(["prune", "--force"], { from: "user" });

    expect(mockMechaPrune).toHaveBeenCalledWith(deps.processManager);
    expect(formatter.success).toHaveBeenCalledWith(expect.stringContaining("2 process(es)"));
  });

  it("shows message when no stopped Mechas", async () => {
    mockMechaLs.mockResolvedValueOnce([{ state: "running" }]);
    const program = new Command();
    registerPruneCommand(program, deps);
    await program.parseAsync(["prune"], { from: "user" });

    expect(formatter.info).toHaveBeenCalledWith("No stopped Mechas to remove.");
    expect(mockMechaPrune).not.toHaveBeenCalled();
  });

  it("prompts for confirmation without --force", async () => {
    mockMechaLs.mockResolvedValueOnce([{ state: "exited" }]);
    mockMechaPrune.mockResolvedValueOnce({ removedProcesses: ["mx-a"] });
    const program = new Command();
    registerPruneCommand(program, deps);
    await program.parseAsync(["prune"], { from: "user" });

    expect(mockMechaPrune).toHaveBeenCalled();
    expect(formatter.success).toHaveBeenCalled();
  });

  it("aborts when user declines confirmation", async () => {
    readlineAnswer = "n";
    mockMechaLs.mockResolvedValueOnce([{ state: "exited" }]);
    const program = new Command();
    registerPruneCommand(program, deps);
    await program.parseAsync(["prune"], { from: "user" });

    expect(formatter.info).toHaveBeenCalledWith("Aborted.");
    expect(mockMechaPrune).not.toHaveBeenCalled();
  });

  it("outputs JSON with --json --force", async () => {
    mockMechaPrune.mockResolvedValueOnce({ removedProcesses: ["a"] });
    const program = new Command();
    program.option("--json", "JSON output");
    registerPruneCommand(program, deps);
    await program.parseAsync(["--json", "prune", "--force"], { from: "user" });

    expect(formatter.json).toHaveBeenCalledWith({ removedProcesses: ["a"] });
  });

  it("reports error on failure", async () => {
    mockMechaPrune.mockRejectedValueOnce(new Error("process error"));
    const program = new Command();
    registerPruneCommand(program, deps);
    await program.parseAsync(["prune", "--force"], { from: "user" });

    expect(formatter.error).toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });
});
