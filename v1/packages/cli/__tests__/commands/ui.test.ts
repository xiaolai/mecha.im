import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerUiCommand } from "../../src/commands/ui.js";
import { Command } from "commander";
import type { CommandDeps } from "../../src/types.js";
import type { Formatter } from "../../src/output/formatter.js";

const mockResolveUiUrl = vi.fn();

vi.mock("@mecha/service", () => ({
  resolveUiUrl: (...args: unknown[]) => mockResolveUiUrl(...args),
}));

function createMockFormatter(): Formatter {
  return { info: vi.fn(), error: vi.fn(), success: vi.fn(), json: vi.fn(), table: vi.fn() };
}

describe("mecha ui", () => {
  let formatter: Formatter;
  let deps: CommandDeps;

  beforeEach(() => {
    formatter = createMockFormatter();
    deps = { processManager: {} as any, formatter };
    process.exitCode = undefined;
    vi.clearAllMocks();
  });

  it("prints URL when port is found", async () => {
    mockResolveUiUrl.mockResolvedValue({ url: "http://127.0.0.1:7700" });

    const program = new Command();
    registerUiCommand(program, deps);
    await program.parseAsync(["ui", "mx-test-abc123"], { from: "user" });

    expect(formatter.info).toHaveBeenCalledWith("http://127.0.0.1:7700");
  });

  it("errors when service throws", async () => {
    mockResolveUiUrl.mockRejectedValueOnce(new Error("No port binding for mx-test-abc123"));

    const program = new Command();
    registerUiCommand(program, deps);
    await program.parseAsync(["ui", "mx-test-abc123"], { from: "user" });

    expect(formatter.error).toHaveBeenCalledWith(expect.stringContaining("No port"));
    expect(process.exitCode).toBe(1);
  });

  it("reports errors on inspect failure", async () => {
    mockResolveUiUrl.mockRejectedValueOnce(new Error("not found"));

    const program = new Command();
    registerUiCommand(program, deps);
    await program.parseAsync(["ui", "mx-bad"], { from: "user" });

    expect(formatter.error).toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });
});
