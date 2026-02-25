import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createProgram } from "../../src/program.js";
import { makeDeps } from "../test-utils.js";

describe("doctor command", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it("reports healthy system with sandbox check", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-doctor-"));
    const mechaDir = join(tempDir, ".mecha");
    mkdirSync(mechaDir, { recursive: true });
    for (const sub of ["auth", "tools", "logs"]) mkdirSync(join(mechaDir, sub));
    writeFileSync(join(mechaDir, "node-id"), "test-id\n");

    const deps = makeDeps({ mechaDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "doctor"]);
    expect(deps.formatter.success).toHaveBeenCalledWith(expect.stringContaining("healthy"));
    // Sandbox check should appear in output (either as success or warn)
    const allCalls = [...(deps.formatter.success as ReturnType<typeof vi.fn>).mock.calls, ...(deps.formatter.warn as ReturnType<typeof vi.fn>).mock.calls];
    const sandboxMsg = allCalls.find((c: string[]) => c[0]?.includes("sandbox"));
    expect(sandboxMsg).toBeDefined();
  });

  it("reports unhealthy system", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-doctor-"));
    const mechaDir = join(tempDir, "nonexistent");

    const deps = makeDeps({ mechaDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "doctor"]);
    expect(deps.formatter.error).toHaveBeenCalledWith(expect.stringContaining("issues"));
  });
});
