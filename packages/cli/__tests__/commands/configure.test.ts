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

  it("shows nothing-to-update when no flags provided", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-cfg-"));
    const info: ProcessInfo = { name: "alice" as CasaName, state: "running", workspacePath: "/ws", port: 7700 };
    const deps = makeDeps({
      mechaDir,
      pm: { get: vi.fn().mockReturnValue(info) },
    });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "configure", "alice"]);
    expect(deps.formatter.info).toHaveBeenCalledWith("Nothing to update");
  });

  it("rejects invalid tags", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-cfg-"));
    const deps = makeDeps({ mechaDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "configure", "alice", "--tags", "has space"]);
    expect(deps.formatter.error).toHaveBeenCalledWith(expect.stringContaining("invalid characters"));
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined as unknown as number;
  });

  it("writes config even when existing config is corrupt", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-cfg-"));
    const casaDir = join(mechaDir, "alice");
    mkdirSync(casaDir, { recursive: true });
    writeFileSync(join(casaDir, "config.json"), "not-json{{{");

    const info: ProcessInfo = { name: "alice" as CasaName, state: "running", workspacePath: "/ws", port: 7700 };
    const deps = makeDeps({
      mechaDir,
      pm: { get: vi.fn().mockReturnValue(info) },
    });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "configure", "alice", "--tags", "new-tag"]);
    expect(deps.formatter.success).toHaveBeenCalledWith("alice updated");
    const cfg = JSON.parse(readFileSync(join(casaDir, "config.json"), "utf-8"));
    expect(cfg.tags).toEqual(["new-tag"]);
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

  it("updates expose capabilities", async () => {
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

    await program.parseAsync(["node", "mecha", "configure", "alice", "--expose", "query,read_workspace"]);
    expect(deps.formatter.success).toHaveBeenCalledWith("alice updated");
    const cfg = JSON.parse(readFileSync(join(casaDir, "config.json"), "utf-8"));
    expect(cfg.expose).toEqual(["query", "read_workspace"]);
  });

  it("rejects invalid capability", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-cfg-"));
    const deps = makeDeps({ mechaDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "configure", "alice", "--expose", "invalid_cap"]);
    expect(deps.formatter.error).toHaveBeenCalledWith(expect.stringContaining("Invalid capability"));
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined as unknown as number;
  });

  it("updates both tags and expose together", async () => {
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

    await program.parseAsync(["node", "mecha", "configure", "alice", "--tags", "dev", "--expose", "query"]);
    expect(deps.formatter.success).toHaveBeenCalledWith("alice updated");
    const cfg = JSON.parse(readFileSync(join(casaDir, "config.json"), "utf-8"));
    expect(cfg.tags).toEqual(["dev"]);
    expect(cfg.expose).toEqual(["query"]);
  });
});
