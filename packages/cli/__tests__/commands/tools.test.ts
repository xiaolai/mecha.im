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

describe("tools commands", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it("installs a tool", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-tools-"));
    const deps = makeDeps(tempDir);
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "tools", "install", "web-search"]);
    expect(deps.formatter.success).toHaveBeenCalledWith(expect.stringContaining("Installed"));
  });

  it("installs with version and description", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-tools-"));
    const deps = makeDeps(tempDir);
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "tools", "install", "search", "-v", "1.0.0", "-d", "Search tool"]);
    expect(deps.formatter.success).toHaveBeenCalledWith(expect.stringContaining("1.0.0"));
  });

  it("lists tools (empty)", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-tools-"));
    const deps = makeDeps(tempDir);
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "tools", "ls"]);
    expect(deps.formatter.info).toHaveBeenCalledWith("No tools installed");
  });

  it("lists installed tools", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-tools-"));
    const deps = makeDeps(tempDir);
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "tools", "install", "tool-a"]);
    await program.parseAsync(["node", "mecha", "tools", "ls"]);
    expect(deps.formatter.table).toHaveBeenCalled();
  });
});
