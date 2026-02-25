import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createProgram } from "../../src/program.js";
import { makeDeps } from "../test-utils.js";
import type { ProcessInfo } from "@mecha/process";
import type { CasaName } from "@mecha/core";

function makeInfo(name: string, port: number): ProcessInfo {
  return {
    name: name as CasaName,
    state: "running",
    pid: 1000,
    port,
    workspacePath: "/ws",
    startedAt: "2026-01-01T00:00:00Z",
  };
}

describe("find command", () => {
  let mechaDir: string;
  afterEach(() => { if (mechaDir) rmSync(mechaDir, { recursive: true, force: true }); });

  function writeCasaConfig(name: string, tags: string[]): void {
    const dir = join(mechaDir, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "config.json"), JSON.stringify({ port: 7700, token: "t", workspace: "/ws", tags }));
  }

  it("displays matching CASAs in table", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-find-"));
    writeCasaConfig("alice", ["code", "typescript"]);
    writeCasaConfig("bob", ["code", "review"]);

    const deps = makeDeps({
      mechaDir,
      pm: { list: vi.fn().mockReturnValue([makeInfo("alice", 7701), makeInfo("bob", 7702)]) },
    });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "find", "--tag", "code"]);
    expect(deps.formatter.table).toHaveBeenCalledWith(
      ["Name", "Tags", "Port", "State"],
      expect.arrayContaining([
        expect.arrayContaining(["alice"]),
        expect.arrayContaining(["bob"]),
      ]),
    );
  });

  it("shows message when no matches", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-find-"));
    writeCasaConfig("alice", ["research"]);

    const deps = makeDeps({
      mechaDir,
      pm: { list: vi.fn().mockReturnValue([makeInfo("alice", 7701)]) },
    });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "find", "--tag", "nonexistent"]);
    expect(deps.formatter.info).toHaveBeenCalledWith(expect.stringContaining("No CASAs found"));
  });

  it("shows generic message when no CASAs and no tag filter", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-find-"));
    const deps = makeDeps({
      mechaDir,
      pm: { list: vi.fn().mockReturnValue([]) },
    });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "find"]);
    expect(deps.formatter.info).toHaveBeenCalledWith("No CASAs found");
  });

  it("lists all CASAs when no tag filter", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-find-"));
    writeCasaConfig("alice", ["research"]);

    const deps = makeDeps({
      mechaDir,
      pm: { list: vi.fn().mockReturnValue([makeInfo("alice", 7701)]) },
    });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "find"]);
    expect(deps.formatter.table).toHaveBeenCalledWith(
      ["Name", "Tags", "Port", "State"],
      [["alice", "research", "7701", "running"]],
    );
  });

  it("shows dash for empty tags and undefined port", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-find-"));
    const dir = join(mechaDir, "alice");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "config.json"), JSON.stringify({ port: 7700, token: "t", workspace: "/ws" }));

    const info: ProcessInfo = { name: "alice" as CasaName, state: "stopped", workspacePath: "/ws", port: undefined };
    const deps = makeDeps({
      mechaDir,
      pm: { list: vi.fn().mockReturnValue([info]) },
    });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "find"]);
    expect(deps.formatter.table).toHaveBeenCalledWith(
      ["Name", "Tags", "Port", "State"],
      [["alice", "-", "-", "stopped"]],
    );
  });

  it("filters with AND logic across multiple --tag flags", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-find-"));
    writeCasaConfig("alice", ["code", "typescript"]);
    writeCasaConfig("bob", ["code", "review"]);

    const deps = makeDeps({
      mechaDir,
      pm: { list: vi.fn().mockReturnValue([makeInfo("alice", 7701), makeInfo("bob", 7702)]) },
    });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "find", "--tag", "code", "--tag", "review"]);
    expect(deps.formatter.table).toHaveBeenCalledWith(
      ["Name", "Tags", "Port", "State"],
      [["bob", "code, review", "7702", "running"]],
    );
  });
});
