import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { registerUpCommand } from "../../src/commands/up.js";
import { Command } from "commander";
import type { CommandDeps } from "../../src/types.js";
import type { Formatter } from "../../src/output/formatter.js";
import { tmpdir } from "node:os";

function createMockFormatter(): Formatter {
  return {
    info: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    json: vi.fn(),
    table: vi.fn(),
  };
}

const mockMechaUp = vi.fn();
const mockLoadDotEnvFiles = vi.fn().mockReturnValue({});

vi.mock("@mecha/service", () => ({
  mechaUp: (...args: unknown[]) => mockMechaUp(...args),
  loadDotEnvFiles: (...args: unknown[]) => mockLoadDotEnvFiles(...args),
}));

describe("mecha up", () => {
  let formatter: Formatter;
  const originalEnv = process.env;

  beforeEach(() => {
    formatter = createMockFormatter();
    process.exitCode = undefined;
    process.env = { ...originalEnv };
    vi.clearAllMocks();
    mockMechaUp.mockResolvedValue({
      id: "mx-t-abc123",
      name: "mecha-mx-t-abc123",
      port: 7700,
      authToken: "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
    });
    mockLoadDotEnvFiles.mockReturnValue({});
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("starts a container for a valid path", async () => {
    const deps: CommandDeps = { processManager: {} as any, formatter };
    const program = new Command();
    registerUpCommand(program, deps);

    await program.parseAsync(["up", tmpdir()], { from: "user" });

    expect(formatter.success).toHaveBeenCalledWith(expect.stringContaining("started successfully"));
    expect(mockMechaUp).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBeUndefined();
  });

  it("passes options through to mechaUp", async () => {
    const deps: CommandDeps = { processManager: {} as any, formatter };
    const program = new Command();
    registerUpCommand(program, deps);

    await program.parseAsync([
      "up", tmpdir(),
      "-p", "8080",
      "--claude-token", "my-token",
      "--otp", "my-secret",
      "--permission-mode", "full-auto",
    ], { from: "user" });

    expect(mockMechaUp).toHaveBeenCalledTimes(1);
    const [, input] = mockMechaUp.mock.calls[0];
    expect(input.port).toBe(8080);
    expect(input.claudeToken).toBe("my-token");
    expect(input.otp).toBe("my-secret");
    expect(input.permissionMode).toBe("full-auto");
  });

  it("falls back to env vars for claude-token and otp", async () => {
    process.env["CLAUDE_CODE_OAUTH_TOKEN"] = "env-token";
    process.env["MECHA_OTP"] = "env-otp";

    const deps: CommandDeps = { processManager: {} as any, formatter };
    const program = new Command();
    registerUpCommand(program, deps);

    await program.parseAsync(["up", tmpdir()], { from: "user" });

    const [, input] = mockMechaUp.mock.calls[0];
    expect(input.claudeToken).toBe("env-token");
    expect(input.otp).toBe("env-otp");
  });

  it("falls back to env var for ANTHROPIC_API_KEY", async () => {
    process.env["ANTHROPIC_API_KEY"] = "env-api-key";

    const deps: CommandDeps = { processManager: {} as any, formatter };
    const program = new Command();
    registerUpCommand(program, deps);

    await program.parseAsync(["up", tmpdir()], { from: "user" });

    const [, input] = mockMechaUp.mock.calls[0];
    expect(input.anthropicApiKey).toBe("env-api-key");
  });

  it("falls back to .env file values", async () => {
    mockLoadDotEnvFiles.mockReturnValue({
      CLAUDE_CODE_OAUTH_TOKEN: "dotenv-token",
      MECHA_OTP: "dotenv-otp",
    });

    const deps: CommandDeps = { processManager: {} as any, formatter };
    const program = new Command();
    registerUpCommand(program, deps);

    await program.parseAsync(["up", tmpdir()], { from: "user" });

    const [, input] = mockMechaUp.mock.calls[0];
    expect(input.claudeToken).toBe("dotenv-token");
    expect(input.otp).toBe("dotenv-otp");
  });

  it("falls back to .env file for ANTHROPIC_API_KEY", async () => {
    delete process.env["ANTHROPIC_API_KEY"];
    mockLoadDotEnvFiles.mockReturnValue({
      ANTHROPIC_API_KEY: "dotenv-api-key",
    });

    const deps: CommandDeps = { processManager: {} as any, formatter };
    const program = new Command();
    registerUpCommand(program, deps);

    await program.parseAsync(["up", tmpdir()], { from: "user" });

    const [, input] = mockMechaUp.mock.calls[0];
    expect(input.anthropicApiKey).toBe("dotenv-api-key");
  });

  it("shows full token with --show-token", async () => {
    const deps: CommandDeps = { processManager: {} as any, formatter };
    const program = new Command();
    registerUpCommand(program, deps);

    await program.parseAsync(["up", tmpdir(), "--show-token"], { from: "user" });

    const infoCalls = (formatter.info as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0] as string);
    const authLine = infoCalls.find((c) => c.includes("Auth:"));
    expect(authLine).toBeDefined();
    expect(authLine).not.toContain("...");
  });

  it("truncates token by default", async () => {
    const deps: CommandDeps = { processManager: {} as any, formatter };
    const program = new Command();
    registerUpCommand(program, deps);

    await program.parseAsync(["up", tmpdir()], { from: "user" });

    const infoCalls = (formatter.info as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0] as string);
    const authLine = infoCalls.find((c) => c.includes("Auth:"));
    expect(authLine).toBeDefined();
    expect(authLine).toContain("...");
  });

  it("reports service errors", async () => {
    mockMechaUp.mockRejectedValueOnce(new Error("image not found"));

    const deps: CommandDeps = { processManager: {} as any, formatter };
    const program = new Command();
    registerUpCommand(program, deps);

    await program.parseAsync(["up", tmpdir()], { from: "user" });

    expect(formatter.error).toHaveBeenCalledWith("image not found");
    expect(process.exitCode).toBe(1);
  });

  it("calls loadDotEnvFiles with project path", async () => {
    const deps: CommandDeps = { processManager: {} as any, formatter };
    const program = new Command();
    registerUpCommand(program, deps);

    await program.parseAsync(["up", tmpdir()], { from: "user" });

    expect(mockLoadDotEnvFiles).toHaveBeenCalledTimes(1);
  });
});
