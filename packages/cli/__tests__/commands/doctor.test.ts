import { describe, it, expect, afterEach } from "vitest";
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

  it("reports healthy system", async () => {
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
