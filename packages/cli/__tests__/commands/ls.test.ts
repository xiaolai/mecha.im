import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerLsCommand } from "../../src/commands/ls.js";
import { Command } from "commander";
import type { CommandDeps } from "../../src/types.js";
import type { Formatter } from "../../src/output/formatter.js";

function createMockFormatter(): Formatter {
  return {
    info: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    json: vi.fn(),
    table: vi.fn(),
  };
}

const mockMechaLs = vi.fn();

vi.mock("@mecha/service", () => ({
  mechaLs: (...args: unknown[]) => mockMechaLs(...args),
}));

function makeFakeItems() {
  return [
    {
      id: "mx-test-abc123",
      name: "mecha-mx-test-abc123",
      state: "running",
      status: "Up 5 minutes",
      path: "/home/user/project",
      port: 7700,
      created: 1700000000,
    },
  ];
}

describe("mecha ls", () => {
  let formatter: Formatter;

  beforeEach(() => {
    formatter = createMockFormatter();
    process.exitCode = undefined;
    vi.clearAllMocks();
    mockMechaLs.mockResolvedValue(makeFakeItems());
  });

  it("lists containers as a table", async () => {
    const deps: CommandDeps = { processManager: {} as any, formatter };
    const program = new Command();
    program.option("--json", "JSON output");
    registerLsCommand(program, deps);

    await program.parseAsync(["ls"], { from: "user" });

    expect(formatter.table).toHaveBeenCalledTimes(1);
    const rows = (formatter.table as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as Record<string, string>[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.ID).toBe("mx-test-abc123");
    expect(rows[0]!.STATE).toBe("running");
  });

  it("reports errors on mechaLs failure", async () => {
    mockMechaLs.mockRejectedValueOnce(new Error("process error"));
    const deps: CommandDeps = { processManager: {} as any, formatter };

    const program = new Command();
    program.option("--json", "JSON output");
    registerLsCommand(program, deps);
    await program.parseAsync(["ls"], { from: "user" });

    expect(formatter.error).toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("outputs JSON when --json flag is set", async () => {
    const deps: CommandDeps = { processManager: {} as any, formatter };
    const program = new Command();
    program.option("--json", "JSON output");
    registerLsCommand(program, deps);

    await program.parseAsync(["--json", "ls"], { from: "user" });

    expect(formatter.json).toHaveBeenCalledTimes(1);
    const data = (formatter.json as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as Array<{ id: string }>;
    expect(data).toHaveLength(1);
    expect(data[0]!.id).toBe("mx-test-abc123");
  });
});
