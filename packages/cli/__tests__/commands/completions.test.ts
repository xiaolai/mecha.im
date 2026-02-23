import { describe, it, expect, vi, beforeEach } from "vitest";
import { Command } from "commander";
import type { CommandDeps } from "../../src/types.js";
import type { Formatter } from "../../src/output/formatter.js";
import { registerCompletionsCommand } from "../../src/commands/completions.js";

function createMockFormatter(): Formatter {
  return { info: vi.fn(), error: vi.fn(), success: vi.fn(), json: vi.fn(), table: vi.fn() };
}

describe("mecha completions", () => {
  let formatter: Formatter;
  let deps: CommandDeps;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  function createProgramWithCommands(): Command {
    const program = new Command();
    // Register some sample commands to test dynamic derivation
    program.command("up <path>");
    program.command("ls");
    program.command("status <id>");
    registerCompletionsCommand(program, deps);
    return program;
  }

  beforeEach(() => {
    formatter = createMockFormatter();
    deps = { processManager: {} as any, formatter };
    process.exitCode = undefined;
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, "log").mockReturnValue();
    errSpy = vi.spyOn(console, "error").mockReturnValue();
  });

  it("generates bash completions containing registered commands", async () => {
    const program = createProgramWithCommands();
    await program.parseAsync(["completions", "bash"], { from: "user" });

    const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("up");
    expect(output).toContain("ls");
    expect(output).toContain("status");
    expect(output).toContain("completions");
    expect(output).toContain("_mecha_completions");
    logSpy.mockRestore();
    errSpy.mockRestore();
  });

  it("generates zsh completions containing registered commands", async () => {
    const program = createProgramWithCommands();
    await program.parseAsync(["completions", "zsh"], { from: "user" });

    const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("up");
    expect(output).toContain("ls");
    expect(output).toContain("status");
    expect(output).toContain("compdef");
    logSpy.mockRestore();
    errSpy.mockRestore();
  });

  it("generates fish completions containing registered commands", async () => {
    const program = createProgramWithCommands();
    await program.parseAsync(["completions", "fish"], { from: "user" });

    const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("up");
    expect(output).toContain("ls");
    expect(output).toContain("status");
    expect(output).toContain("complete -c mecha");
    logSpy.mockRestore();
    errSpy.mockRestore();
  });

  it("errors on unknown shell", async () => {
    const program = createProgramWithCommands();
    await program.parseAsync(["completions", "powershell"], { from: "user" });

    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("Unknown shell"));
    expect(process.exitCode).toBe(1);
    logSpy.mockRestore();
    errSpy.mockRestore();
  });
});
