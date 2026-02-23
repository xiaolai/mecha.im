import { describe, it, expect, vi, beforeEach } from "vitest";
import { Command } from "commander";
import type { CommandDeps } from "../../src/types.js";
import type { Formatter } from "../../src/output/formatter.js";
import { registerTokenCommand } from "../../src/commands/token.js";

const mockMechaToken = vi.fn();

vi.mock("@mecha/service", () => ({
  mechaToken: (...args: unknown[]) => mockMechaToken(...args),
}));

function createMockFormatter(): Formatter {
  return { info: vi.fn(), error: vi.fn(), success: vi.fn(), json: vi.fn(), table: vi.fn() };
}

describe("mecha token", () => {
  let formatter: Formatter;
  let deps: CommandDeps;

  beforeEach(() => {
    formatter = createMockFormatter();
    deps = { processManager: {} as any, formatter };
    process.exitCode = undefined;
    vi.clearAllMocks();
  });

  it("displays the token", async () => {
    mockMechaToken.mockResolvedValueOnce({ id: "mx-abc", token: "secret-token-123" });
    const program = new Command();
    registerTokenCommand(program, deps);
    await program.parseAsync(["token", "mx-abc"], { from: "user" });

    expect(formatter.info).toHaveBeenCalledWith("secret-token-123");
  });

  it("outputs JSON with --json flag", async () => {
    mockMechaToken.mockResolvedValueOnce({ id: "mx-abc", token: "tok-xyz" });
    const program = new Command();
    program.option("--json", "JSON output");
    registerTokenCommand(program, deps);
    await program.parseAsync(["--json", "token", "mx-abc"], { from: "user" });

    expect(formatter.json).toHaveBeenCalledWith({ id: "mx-abc", token: "tok-xyz" });
  });

  it("reports error when container not found", async () => {
    mockMechaToken.mockRejectedValueOnce(new Error("container not found"));
    const program = new Command();
    registerTokenCommand(program, deps);
    await program.parseAsync(["token", "mx-bad"], { from: "user" });

    expect(formatter.error).toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("reports error when token env var missing", async () => {
    mockMechaToken.mockRejectedValueOnce(new Error("No auth token found"));
    const program = new Command();
    registerTokenCommand(program, deps);
    await program.parseAsync(["token", "mx-no-token"], { from: "user" });

    expect(formatter.error).toHaveBeenCalledWith(expect.stringContaining("No auth token found"));
    expect(process.exitCode).toBe(1);
  });
});
