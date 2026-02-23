import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerDoctorCommand } from "../../src/commands/doctor.js";
import { Command } from "commander";
import type { CommandDeps } from "../../src/types.js";
import type { Formatter } from "../../src/output/formatter.js";

const mockMechaDoctor = vi.fn();

vi.mock("@mecha/service", () => ({
  mechaDoctor: (...args: unknown[]) => mockMechaDoctor(...args),
}));

function createMockFormatter(): Formatter & {
  calls: { method: string; args: unknown[] }[];
} {
  const calls: { method: string; args: unknown[] }[] = [];
  return {
    calls,
    info: vi.fn((...args: unknown[]) => calls.push({ method: "info", args })),
    error: vi.fn((...args: unknown[]) => calls.push({ method: "error", args })),
    success: vi.fn((...args: unknown[]) => calls.push({ method: "success", args })),
    json: vi.fn((...args: unknown[]) => calls.push({ method: "json", args })),
    table: vi.fn((...args: unknown[]) => calls.push({ method: "table", args })),
  };
}

describe("mecha doctor", () => {
  let formatter: ReturnType<typeof createMockFormatter>;

  beforeEach(() => {
    formatter = createMockFormatter();
    process.exitCode = undefined;
    vi.clearAllMocks();
  });

  it("reports healthy when Claude CLI and sandbox are available", async () => {
    mockMechaDoctor.mockResolvedValue({
      claudeCliAvailable: true,
      sandboxSupported: true,
      issues: [],
    });

    const deps: CommandDeps = { processManager: {} as any, formatter };
    const program = new Command();
    registerDoctorCommand(program, deps);
    await program.parseAsync(["doctor"], { from: "user" });

    expect(mockMechaDoctor).toHaveBeenCalledWith();
    const successMessages = formatter.calls
      .filter((c) => c.method === "success")
      .map((c) => c.args[0]);
    expect(successMessages).toContainEqual(expect.stringContaining("Claude CLI: available"));
    expect(successMessages).toContainEqual(expect.stringContaining("Sandbox: supported"));
    expect(successMessages).toContainEqual(expect.stringContaining("All checks passed"));
    expect(process.exitCode).toBeUndefined();
  });

  it("reports error when Claude CLI is missing", async () => {
    mockMechaDoctor.mockResolvedValue({
      claudeCliAvailable: false,
      sandboxSupported: true,
      issues: ["Claude CLI not found."],
    });

    const deps: CommandDeps = { processManager: {} as any, formatter };
    const program = new Command();
    registerDoctorCommand(program, deps);
    await program.parseAsync(["doctor"], { from: "user" });

    expect(formatter.error).toHaveBeenCalledWith(expect.stringContaining("Claude CLI not found"));
    expect(process.exitCode).toBe(1);
  });

  it("reports error when sandbox is unsupported", async () => {
    mockMechaDoctor.mockResolvedValue({
      claudeCliAvailable: true,
      sandboxSupported: false,
      issues: ["Sandbox not supported."],
    });

    const deps: CommandDeps = { processManager: {} as any, formatter };
    const program = new Command();
    registerDoctorCommand(program, deps);
    await program.parseAsync(["doctor"], { from: "user" });

    expect(formatter.error).toHaveBeenCalledWith(expect.stringContaining("Sandbox not supported"));
    expect(process.exitCode).toBe(1);
  });
});
