import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createProgram } from "../../src/program.js";
import type { CommandDeps } from "../../src/types.js";
import type { ProcessManager } from "@mecha/process";

function makeDeps(mechaDir: string): CommandDeps {
  return {
    formatter: {
      success: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      json: vi.fn(),
      table: vi.fn(),
    },
    processManager: {} as ProcessManager,
    mechaDir,
  };
}

describe("init command", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it("initializes mecha directory", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-init-"));
    const mechaDir = join(tempDir, ".mecha");
    const deps = makeDeps(mechaDir);
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "init"]);
    expect(deps.formatter.success).toHaveBeenCalledWith(expect.stringContaining("Initialized"));
    expect(deps.formatter.info).toHaveBeenCalledWith(expect.stringContaining("Node ID"));
  });

  it("reports already initialized on second run", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-init-"));
    const mechaDir = join(tempDir, ".mecha");
    const deps = makeDeps(mechaDir);
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "init"]);
    await program.parseAsync(["node", "mecha", "init"]);
    expect(deps.formatter.info).toHaveBeenCalledWith(expect.stringContaining("Already initialized"));
  });
});
