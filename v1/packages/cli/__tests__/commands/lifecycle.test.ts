import { describe, it, expect, vi, beforeEach } from "vitest";
import { Command } from "commander";
import type { CommandDeps } from "../../src/types.js";
import type { Formatter } from "../../src/output/formatter.js";
import { registerStopCommand, registerStartCommand, registerRestartCommand } from "../../src/commands/lifecycle.js";

const mockMechaStop = vi.fn().mockResolvedValue(undefined);
const mockMechaStart = vi.fn().mockResolvedValue(undefined);
const mockMechaRestart = vi.fn().mockResolvedValue(undefined);

vi.mock("@mecha/service", () => ({
  mechaStop: (...args: unknown[]) => mockMechaStop(...args),
  mechaStart: (...args: unknown[]) => mockMechaStart(...args),
  mechaRestart: (...args: unknown[]) => mockMechaRestart(...args),
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

describe("lifecycle commands", () => {
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

  describe("mecha stop", () => {
    it("stops a container by id", async () => {
      const program = new Command();
      registerStopCommand(program, deps);
      await program.parseAsync(["stop", "mx-test-abc123"], { from: "user" });

      expect(mockMechaStop).toHaveBeenCalledWith(deps.processManager, "mx-test-abc123");
      expect(formatter.success).toHaveBeenCalledWith(expect.stringContaining("stopped"));
    });

    it("reports errors", async () => {
      mockMechaStop.mockRejectedValueOnce(new Error("not found"));
      const program = new Command();
      registerStopCommand(program, deps);
      await program.parseAsync(["stop", "mx-bad"], { from: "user" });

      expect(formatter.error).toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
    });
  });

  describe("mecha start", () => {
    it("starts a container by id", async () => {
      const program = new Command();
      registerStartCommand(program, deps);
      await program.parseAsync(["start", "mx-test-abc123"], { from: "user" });

      expect(mockMechaStart).toHaveBeenCalledWith(deps.processManager, "mx-test-abc123");
      expect(formatter.success).toHaveBeenCalledWith(expect.stringContaining("started"));
    });
  });

  describe("mecha restart", () => {
    it("restarts a container", async () => {
      const program = new Command();
      registerRestartCommand(program, deps);
      await program.parseAsync(["restart", "mx-test-abc123"], { from: "user" });

      expect(mockMechaRestart).toHaveBeenCalledWith(deps.processManager, "mx-test-abc123");
      expect(formatter.success).toHaveBeenCalledWith(expect.stringContaining("restarted"));
    });
  });
});
