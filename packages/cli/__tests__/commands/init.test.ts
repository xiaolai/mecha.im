import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerInitCommand } from "../../src/commands/init.js";
import { Command } from "commander";
import type { CommandDeps } from "../../src/types.js";
import type { Formatter } from "../../src/output/formatter.js";

const mockMechaInit = vi.fn();

vi.mock("@mecha/service", () => ({
  mechaInit: (...args: unknown[]) => mockMechaInit(...args),
}));

function createMockFormatter(): Formatter {
  return { info: vi.fn(), error: vi.fn(), success: vi.fn(), json: vi.fn(), table: vi.fn() };
}

describe("mecha init", () => {
  let formatter: Formatter;
  let deps: CommandDeps;

  beforeEach(() => {
    formatter = createMockFormatter();
    deps = { processManager: {} as any, formatter };
    process.exitCode = undefined;
    vi.clearAllMocks();
    mockMechaInit.mockResolvedValue(undefined);
  });

  it("initializes mecha environment", async () => {
    const program = new Command();
    registerInitCommand(program, deps);
    await program.parseAsync(["init"], { from: "user" });

    expect(mockMechaInit).toHaveBeenCalledWith();
    expect(formatter.success).toHaveBeenCalledWith(expect.stringContaining("initialized"));
  });

  it("reports error when init fails", async () => {
    mockMechaInit.mockRejectedValueOnce(new Error("permission denied"));

    const program = new Command();
    registerInitCommand(program, deps);
    await program.parseAsync(["init"], { from: "user" });

    expect(formatter.error).toHaveBeenCalledWith("permission denied");
    expect(process.exitCode).toBe(1);
  });
});
