import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createProgram } from "../../src/program.js";
import { makeDeps } from "../test-utils.js";

describe("sandbox show command", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it("shows sandbox profile when present", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-sandbox-"));
    const mechaDir = join(tempDir, ".mecha");
    const botDir = join(mechaDir, "alice");
    mkdirSync(botDir, { recursive: true });
    const profile = {
      platform: "macos",
      profile: { readPaths: ["/usr/bin/node"], writePaths: [], allowedProcesses: [], allowNetwork: true },
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    writeFileSync(join(botDir, "sandbox-profile.json"), JSON.stringify(profile));

    const deps = makeDeps({ mechaDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "sandbox", "show", "alice"]);
    expect(deps.formatter.json).toHaveBeenCalledWith(profile);
  });

  it("handles corrupt sandbox-profile.json gracefully", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-sandbox-"));
    const mechaDir = join(tempDir, ".mecha");
    const botDir = join(mechaDir, "alice");
    mkdirSync(botDir, { recursive: true });
    writeFileSync(join(botDir, "sandbox-profile.json"), "not-valid-json{");

    const deps = makeDeps({ mechaDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "sandbox", "show", "alice"]);
    expect(deps.formatter.error).toHaveBeenCalledWith(expect.stringContaining("Failed to read"));
  });

  it("warns when no sandbox profile found", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-sandbox-"));
    const mechaDir = join(tempDir, ".mecha");
    mkdirSync(mechaDir, { recursive: true });

    const deps = makeDeps({ mechaDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "sandbox", "show", "alice"]);
    expect(deps.formatter.warn).toHaveBeenCalledWith(expect.stringContaining("No sandbox profile"));
  });
});
