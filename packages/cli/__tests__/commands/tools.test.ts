import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createProgram } from "../../src/program.js";
import { makeDeps } from "../test-utils.js";

describe("tools commands", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it("installs a tool", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-tools-"));
    const deps = makeDeps({ mechaDir: tempDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "tools", "install", "web-search"]);
    expect(deps.formatter.success).toHaveBeenCalledWith(expect.stringContaining("Installed"));
  });

  it("installs with version and description", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-tools-"));
    const deps = makeDeps({ mechaDir: tempDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "tools", "install", "search", "-v", "1.0.0", "-d", "Search tool"]);
    expect(deps.formatter.success).toHaveBeenCalledWith(expect.stringContaining("1.0.0"));
  });

  it("lists tools (empty)", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-tools-"));
    const deps = makeDeps({ mechaDir: tempDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "tools", "ls"]);
    expect(deps.formatter.info).toHaveBeenCalledWith("No tools installed");
  });

  it("lists installed tools", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-tools-"));
    const deps = makeDeps({ mechaDir: tempDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "tools", "install", "tool-a"]);
    await program.parseAsync(["node", "mecha", "tools", "ls"]);
    const tableCall = (deps.formatter.table as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(tableCall[0]).toEqual(expect.arrayContaining(["Name"]));
    const rows = tableCall[1] as string[][];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(expect.arrayContaining(["tool-a"]));
  });

  it("shows claude runtime info", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-tools-"));
    const deps = makeDeps({ mechaDir: tempDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "tools", "runtime"]);
    // Either shows a table (claude found) or an error message (not found)
    const tableCalled = (deps.formatter.table as ReturnType<typeof vi.fn>).mock.calls.length > 0;
    const errorCalled = (deps.formatter.error as ReturnType<typeof vi.fn>).mock.calls.length > 0;
    expect(tableCalled || errorCalled).toBe(true);
  });
});
