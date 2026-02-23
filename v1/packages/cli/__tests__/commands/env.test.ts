import { describe, it, expect, vi, beforeEach } from "vitest";
import { Command } from "commander";
import type { CommandDeps } from "../../src/types.js";
import type { Formatter } from "../../src/output/formatter.js";
import { registerEnvCommand } from "../../src/commands/env.js";

const mockMechaEnv = vi.fn();

vi.mock("@mecha/service", () => ({
  mechaEnv: (...args: unknown[]) => mockMechaEnv(...args),
}));

function createMockFormatter(): Formatter {
  return { info: vi.fn(), error: vi.fn(), success: vi.fn(), json: vi.fn(), table: vi.fn() };
}

const fakeEnv = {
  id: "mx-test",
  env: [
    { key: "PATH", value: "/usr/bin" },
    { key: "MECHA_AUTH_TOKEN", value: "secret-token" },
    { key: "CLAUDE_CODE_OAUTH_TOKEN", value: "oauth-secret" },
    { key: "ANTHROPIC_API_KEY", value: "api-key" },
    { key: "MECHA_OTP", value: "otp-secret" },
    { key: "MY_VAR", value: "hello" },
    { key: "AWS_SECRET_ACCESS_KEY", value: "aws-secret" },
    { key: "GITHUB_TOKEN", value: "gh-token" },
  ],
};

describe("mecha env", () => {
  let formatter: Formatter;
  let deps: CommandDeps;

  beforeEach(() => {
    formatter = createMockFormatter();
    deps = { processManager: {} as any, formatter };
    process.exitCode = undefined;
    vi.clearAllMocks();
    mockMechaEnv.mockResolvedValue(fakeEnv);
  });

  it("masks sensitive values by default", async () => {
    const program = new Command();
    registerEnvCommand(program, deps);
    await program.parseAsync(["env", "mx-test"], { from: "user" });

    expect(formatter.table).toHaveBeenCalledTimes(1);
    const rows = (formatter.table as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const tokenRow = rows.find((r: Record<string, string>) => r.KEY === "MECHA_AUTH_TOKEN");
    expect(tokenRow.VALUE).toBe("***");
    const oauthRow = rows.find((r: Record<string, string>) => r.KEY === "CLAUDE_CODE_OAUTH_TOKEN");
    expect(oauthRow.VALUE).toBe("***");
    const apiRow = rows.find((r: Record<string, string>) => r.KEY === "ANTHROPIC_API_KEY");
    expect(apiRow.VALUE).toBe("***");
    const otpRow = rows.find((r: Record<string, string>) => r.KEY === "MECHA_OTP");
    expect(otpRow.VALUE).toBe("***");
    const pathRow = rows.find((r: Record<string, string>) => r.KEY === "PATH");
    expect(pathRow.VALUE).toBe("/usr/bin");
    const myRow = rows.find((r: Record<string, string>) => r.KEY === "MY_VAR");
    expect(myRow.VALUE).toBe("hello");
    // Pattern-based masking for keys matching TOKEN/SECRET/PASSWORD/API_KEY/PRIVATE_KEY/CREDENTIAL
    const awsRow = rows.find((r: Record<string, string>) => r.KEY === "AWS_SECRET_ACCESS_KEY");
    expect(awsRow.VALUE).toBe("***");
    const ghRow = rows.find((r: Record<string, string>) => r.KEY === "GITHUB_TOKEN");
    expect(ghRow.VALUE).toBe("***");
  });

  it("reveals secrets with --show-secrets", async () => {
    const program = new Command();
    registerEnvCommand(program, deps);
    await program.parseAsync(["env", "--show-secrets", "mx-test"], { from: "user" });

    const rows = (formatter.table as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const tokenRow = rows.find((r: Record<string, string>) => r.KEY === "MECHA_AUTH_TOKEN");
    expect(tokenRow.VALUE).toBe("secret-token");
  });

  it("outputs JSON with --json flag (masked)", async () => {
    const program = new Command();
    program.option("--json", "JSON output");
    registerEnvCommand(program, deps);
    await program.parseAsync(["--json", "env", "mx-test"], { from: "user" });

    expect(formatter.json).toHaveBeenCalledTimes(1);
    const data = (formatter.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(data.id).toBe("mx-test");
    const tokenEntry = data.env.find((e: { key: string }) => e.key === "MECHA_AUTH_TOKEN");
    expect(tokenEntry.value).toBe("***");
  });

  it("reports error for missing container", async () => {
    mockMechaEnv.mockRejectedValueOnce(new Error("not found"));
    const program = new Command();
    registerEnvCommand(program, deps);
    await program.parseAsync(["env", "mx-bad"], { from: "user" });

    expect(formatter.error).toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });
});
