import { describe, it, expect, vi } from "vitest";
import { createProgram } from "../src/program.js";
import { createFormatter } from "../src/formatter.js";
import type { CommandDeps } from "../src/types.js";

function makeDeps(): CommandDeps {
  return {
    formatter: createFormatter({ quiet: true }),
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
