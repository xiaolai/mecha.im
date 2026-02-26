import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createProgram } from "../../src/program.js";
import { makeDeps } from "../test-utils.js";
import { createNodeIdentity } from "@mecha/core";
import { nodeInit } from "@mecha/service";

describe("node invite command", () => {
  let tempDir: string;
  let mechaDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-invite-"));
    mechaDir = join(tempDir, ".mecha");
  });
  afterEach(() => { rmSync(tempDir, { recursive: true, force: true }); });

  it("creates an invite code", async () => {
    createNodeIdentity(mechaDir);
    nodeInit(mechaDir, { name: "test-node" });

    const deps = makeDeps({ mechaDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "node", "invite"]);

    expect(deps.formatter.success).toHaveBeenCalledWith(
      expect.stringContaining("mecha://invite/"),
    );
    expect(deps.formatter.info).toHaveBeenCalledWith(
      expect.stringContaining("Expires:"),
    );
  });

  it("accepts custom expiry", async () => {
    createNodeIdentity(mechaDir);
    nodeInit(mechaDir, { name: "test-node" });

    const deps = makeDeps({ mechaDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "node", "invite", "--expires", "1h"]);

    expect(deps.formatter.success).toHaveBeenCalledWith(
      expect.stringContaining("mecha://invite/"),
    );
    expect(deps.formatter.info).toHaveBeenCalledWith(
      expect.stringContaining("1h"),
    );
  });

  it("accepts various duration formats", async () => {
    createNodeIdentity(mechaDir);
    nodeInit(mechaDir, { name: "test-node" });

    for (const duration of ["30s", "5m", "7d"]) {
      const deps = makeDeps({ mechaDir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "node", "invite", "--expires", duration]);

      expect(deps.formatter.success).toHaveBeenCalledWith(
        expect.stringContaining("mecha://invite/"),
      );
    }
  });

  it("errors on invalid duration format", async () => {
    createNodeIdentity(mechaDir);
    nodeInit(mechaDir, { name: "test-node" });

    const deps = makeDeps({ mechaDir });
    const program = createProgram(deps);
    program.exitOverride();

    await expect(
      program.parseAsync(["node", "mecha", "node", "invite", "--expires", "invalid"]),
    ).rejects.toThrow("Invalid duration");
  });

  it("errors when node name not set", async () => {
    createNodeIdentity(mechaDir);
    // No nodeInit — name is missing

    const deps = makeDeps({ mechaDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "node", "invite"]);

    expect(deps.formatter.error).toHaveBeenCalledWith(
      expect.stringContaining("Identity not found"),
    );
  });

  it("errors when node not initialized", async () => {
    const deps = makeDeps({ mechaDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "node", "invite"]);

    expect(deps.formatter.error).toHaveBeenCalledWith(
      expect.stringContaining("Identity not found"),
    );
  });
});
