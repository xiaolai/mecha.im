import { describe, it, expect, vi } from "vitest";
import { createProgram } from "../src/program.js";
import { createFormatter } from "../src/formatter.js";
import type { CommandDeps } from "../src/types.js";
import type { ProcessManager } from "@mecha/process";
import type { AclEngine } from "@mecha/core";

function makeDeps(): CommandDeps {
  return {
    formatter: createFormatter({ quiet: true }),
    processManager: {
      spawn: vi.fn(),
      get: vi.fn(),
      list: vi.fn().mockReturnValue([]),
      stop: vi.fn(),
      kill: vi.fn(),
      logs: vi.fn(),
      getPortAndToken: vi.fn(),
      onEvent: vi.fn().mockReturnValue(() => {}),
    } as unknown as ProcessManager,
    mechaDir: "/tmp/mecha-test",
    acl: {
      grant: vi.fn(),
      revoke: vi.fn(),
      check: vi.fn(),
      listRules: vi.fn().mockReturnValue([]),
      listConnections: vi.fn().mockReturnValue([]),
      save: vi.fn(),
    } as unknown as AclEngine,
  };
}

describe("createProgram", () => {
  it("creates a Command instance", () => {
    const program = createProgram(makeDeps());
    expect(program.name()).toBe("mecha");
  });

  it("has version set", () => {
    const program = createProgram(makeDeps());
    expect(program.version()).toBe("0.2.0");
  });

  it("has --json option", () => {
    const program = createProgram(makeDeps());
    const opt = program.options.find((o) => o.long === "--json");
    expect(opt).toBeDefined();
  });

  it("has --quiet option", () => {
    const program = createProgram(makeDeps());
    const opt = program.options.find((o) => o.long === "--quiet");
    expect(opt).toBeDefined();
  });

  it("has --verbose option", () => {
    const program = createProgram(makeDeps());
    const opt = program.options.find((o) => o.long === "--verbose");
    expect(opt).toBeDefined();
  });

  it("has --no-color option", () => {
    const program = createProgram(makeDeps());
    const opt = program.options.find((o) => o.long === "--no-color");
    expect(opt).toBeDefined();
  });

  it("registers all expected commands", () => {
    const program = createProgram(makeDeps());
    const commandNames = program.commands.map((c) => c.name());
    expect(commandNames).toContain("init");
    expect(commandNames).toContain("doctor");
    expect(commandNames).toContain("spawn");
    expect(commandNames).toContain("kill");
    expect(commandNames).toContain("stop");
    expect(commandNames).toContain("ls");
    expect(commandNames).toContain("status");
    expect(commandNames).toContain("logs");
    expect(commandNames).toContain("chat");
    expect(commandNames).toContain("sessions");
    expect(commandNames).toContain("tools");
    expect(commandNames).toContain("auth");
    expect(commandNames).toContain("find");
    expect(commandNames).toContain("configure");
    expect(commandNames).toContain("acl");
    expect(commandNames).toContain("dashboard");
  });

  it("parses --version without error", async () => {
    const program = createProgram(makeDeps());
    program.exitOverride();
    program.configureOutput({
      writeOut: () => {},
      writeErr: () => {},
    });
    await expect(
      program.parseAsync(["node", "mecha", "--version"]),
    ).rejects.toThrow(); // Commander throws on --version with exitOverride
  });

  it("parses --help without error", async () => {
    const program = createProgram(makeDeps());
    program.exitOverride();
    program.configureOutput({
      writeOut: () => {},
      writeErr: () => {},
    });
    await expect(
      program.parseAsync(["node", "mecha", "--help"]),
    ).rejects.toThrow(); // Commander throws on --help with exitOverride
  });
});
