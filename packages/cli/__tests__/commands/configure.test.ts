import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createProgram } from "../../src/program.js";
import { makeDeps } from "../test-utils.js";
import type { ProcessInfo } from "@mecha/process";
import type { CasaName } from "@mecha/core";

describe("configure command", () => {
  let mechaDir: string;
  afterEach(() => { if (mechaDir) rmSync(mechaDir, { recursive: true, force: true }); });

  it("updates tags", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-cfg-"));
    const casaDir = join(mechaDir, "alice");
    mkdirSync(casaDir, { recursive: true });
    writeFileSync(join(casaDir, "config.json"), JSON.stringify({ port: 7700, token: "t", workspace: "/ws" }));

    const info: ProcessInfo = { name: "alice" as CasaName, state: "running", workspacePath: "/ws", port: 7700 };
    const deps = makeDeps({
      mechaDir,
      pm: { get: vi.fn().mockReturnValue(info) },
    });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "configure", "alice", "--tags", "research,papers"]);
    expect(deps.formatter.success).toHaveBeenCalledWith("alice updated");
    const cfg = JSON.parse(readFileSync(join(casaDir, "config.json"), "utf-8"));
    expect(cfg.tags).toEqual(["research", "papers"]);
  });

  it("passes undefined tags when --tags not provided", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-cfg-"));
    const casaDir = join(mechaDir, "alice");
    mkdirSync(casaDir, { recursive: true });
    writeFileSync(join(casaDir, "config.json"), JSON.stringify({ port: 7700, token: "t", workspace: "/ws", tags: ["old"] }));

    const info: ProcessInfo = { name: "alice" as CasaName, state: "running", workspacePath: "/ws", port: 7700 };
    const deps = makeDeps({
      mechaDir,
      pm: { get: vi.fn().mockReturnValue(info) },
    });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "configure", "alice"]);
    expect(deps.formatter.success).toHaveBeenCalledWith("alice updated");
    const cfg = JSON.parse(readFileSync(join(casaDir, "config.json"), "utf-8"));
    expect(cfg.tags).toEqual(["old"]);
  });

  it("handles CasaNotFoundError", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-cfg-"));
    const deps = makeDeps({ mechaDir });
    const program = createProgram(deps);
    program.exitOverride();

    await expect(
      program.parseAsync(["node", "mecha", "configure", "unknown", "--tags", "foo"]),
    ).rejects.toThrow();
  });
});
