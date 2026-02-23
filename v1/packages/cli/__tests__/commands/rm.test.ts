import { describe, it, expect, vi, beforeEach } from "vitest";
import { Command } from "commander";
import type { CommandDeps } from "../../src/types.js";
import type { Formatter } from "../../src/output/formatter.js";
import { registerRmCommand } from "../../src/commands/rm.js";

const mockMechaRm = vi.fn().mockResolvedValue(undefined);

vi.mock("@mecha/service", () => ({
  mechaRm: (...args: unknown[]) => mockMechaRm(...args),
}));

function createMockFormatter(): Formatter {
  return {
    info: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    json: vi.fn(),
    table: vi.fn(),
  };
}

describe("mecha rm", () => {
  let formatter: Formatter;
  let deps: CommandDeps;

  beforeEach(() => {
    formatter = createMockFormatter();
    deps = {
      processManager: {} as any,
      formatter,
    };
    process.exitCode = undefined;
    vi.clearAllMocks();
  });

  it("removes a container", async () => {
    const program = new Command();
    registerRmCommand(program, deps);
    await program.parseAsync(["rm", "mx-test-abc123"], { from: "user" });

    expect(mockMechaRm).toHaveBeenCalledWith(
      deps.processManager,
      { id: "mx-test-abc123", withState: false, force: false },
    );
    expect(formatter.success).toHaveBeenCalledWith(expect.stringContaining("removed"));
  });

  it("removes container and volume with --with-state", async () => {
    const program = new Command();
    registerRmCommand(program, deps);
    await program.parseAsync(["rm", "--with-state", "mx-test-abc123"], { from: "user" });

    expect(mockMechaRm).toHaveBeenCalledWith(
      deps.processManager,
      { id: "mx-test-abc123", withState: true, force: false },
    );
  });

  it("force removes with --force", async () => {
    const program = new Command();
    registerRmCommand(program, deps);
    await program.parseAsync(["rm", "--force", "mx-test-abc123"], { from: "user" });

    expect(mockMechaRm).toHaveBeenCalledWith(
      deps.processManager,
      { id: "mx-test-abc123", withState: false, force: true },
    );
  });

  it("reports error when remove fails", async () => {
    mockMechaRm.mockRejectedValueOnce(new Error("remove failed"));
    const program = new Command();
    registerRmCommand(program, deps);
    await program.parseAsync(["rm", "mx-bad"], { from: "user" });

    expect(formatter.error).toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });
});
