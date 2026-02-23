import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerConfigureCommand } from "../../src/commands/configure.js";
import { Command } from "commander";
import type { CommandDeps } from "../../src/types.js";
import type { Formatter } from "../../src/output/formatter.js";

const mockMechaConfigure = vi.fn();

vi.mock("@mecha/service", () => ({
  mechaConfigure: (...args: unknown[]) => mockMechaConfigure(...args),
}));

function createMockFormatter(): Formatter {
  return { info: vi.fn(), error: vi.fn(), success: vi.fn(), json: vi.fn(), table: vi.fn() };
}

describe("mecha configure", () => {
  let formatter: Formatter;
  let deps: CommandDeps;

  beforeEach(() => {
    formatter = createMockFormatter();
    deps = { processManager: {} as any, formatter };
    process.exitCode = undefined;
    vi.clearAllMocks();
    mockMechaConfigure.mockResolvedValue(undefined);
  });

  it("reconfigures a mecha with claude token", async () => {
    const program = new Command();
    registerConfigureCommand(program, deps);
    await program.parseAsync(["configure", "mx-test-abc123", "--claude-token", "new-token"], { from: "user" });

    expect(mockMechaConfigure).toHaveBeenCalledWith(
      deps.processManager,
      expect.objectContaining({ id: "mx-test-abc123", claudeToken: "new-token" }),
    );
    expect(formatter.success).toHaveBeenCalledWith(expect.stringContaining("reconfigured"));
  });

  it("reconfigures with anthropic key", async () => {
    const program = new Command();
    registerConfigureCommand(program, deps);
    await program.parseAsync(["configure", "mx-test-abc123", "--anthropic-key", "sk-ant-123"], { from: "user" });

    expect(mockMechaConfigure).toHaveBeenCalledWith(
      deps.processManager,
      expect.objectContaining({ anthropicApiKey: "sk-ant-123" }),
    );
  });

  it("reconfigures with otp and permission mode", async () => {
    const program = new Command();
    registerConfigureCommand(program, deps);
    await program.parseAsync([
      "configure", "mx-test-abc123",
      "--otp", "my-secret",
      "--permission-mode", "plan",
    ], { from: "user" });

    expect(mockMechaConfigure).toHaveBeenCalledWith(
      deps.processManager,
      expect.objectContaining({ otp: "my-secret", permissionMode: "plan" }),
    );
  });

  it("reports errors from service", async () => {
    mockMechaConfigure.mockRejectedValueOnce(new Error("No fields to update"));

    const program = new Command();
    registerConfigureCommand(program, deps);
    await program.parseAsync(["configure", "mx-test-abc123", "--claude-token", "x"], { from: "user" });

    expect(formatter.error).toHaveBeenCalledWith("No fields to update");
    expect(process.exitCode).toBe(1);
  });
});
