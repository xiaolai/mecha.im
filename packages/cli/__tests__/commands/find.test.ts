import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createProgram } from "../../src/program.js";
import { makeDeps } from "../test-utils.js";
import type { ProcessInfo } from "@mecha/process";
import type { BotName } from "@mecha/core";

function makeInfo(name: string, port: number): ProcessInfo {
  return {
    name: name as BotName,
    state: "running",
    pid: 1000,
    port,
    workspacePath: "/ws",
    startedAt: "2026-01-01T00:00:00Z",
  };
}

describe("bot find command", () => {
  let mechaDir: string;
  afterEach(() => { if (mechaDir) rmSync(mechaDir, { recursive: true, force: true }); });

  function writeBotConfig(name: string, tags: string[]): void {
    const dir = join(mechaDir, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "config.json"), JSON.stringify({ port: 7700, token: "t", workspace: "/ws", tags }));
  }

  it("displays matching bots in table", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-find-"));
    writeBotConfig("alice", ["code", "typescript"]);
    writeBotConfig("bob", ["code", "review"]);

    const deps = makeDeps({
      mechaDir,
      pm: { list: vi.fn().mockReturnValue([makeInfo("alice", 7701), makeInfo("bob", 7702)]) },
    });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "find", "--tag", "code"]);
    expect(deps.formatter.table).toHaveBeenCalledWith(
      ["Name", "State", "Port", "Tags"],
      expect.arrayContaining([
        expect.arrayContaining(["alice"]),
        expect.arrayContaining(["bob"]),
      ]),
    );
  });

  it("shows message when no matches", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-find-"));
    writeBotConfig("alice", ["research"]);

    const deps = makeDeps({
      mechaDir,
      pm: { list: vi.fn().mockReturnValue([makeInfo("alice", 7701)]) },
    });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "find", "--tag", "nonexistent"]);
    expect(deps.formatter.info).toHaveBeenCalledWith(expect.stringContaining("No bots found"));
  });

  it("shows generic message when no bots and no tag filter", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-find-"));
    const deps = makeDeps({
      mechaDir,
      pm: { list: vi.fn().mockReturnValue([]) },
    });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "find"]);
    expect(deps.formatter.info).toHaveBeenCalledWith("No bots found");
  });

  it("lists all bots when no tag filter", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-find-"));
    writeBotConfig("alice", ["research"]);

    const deps = makeDeps({
      mechaDir,
      pm: { list: vi.fn().mockReturnValue([makeInfo("alice", 7701)]) },
    });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "find"]);
    expect(deps.formatter.table).toHaveBeenCalledWith(
      ["Name", "State", "Port", "Tags"],
      [["alice", "running", "7701", "research"]],
    );
  });

  it("shows dash for empty tags and undefined port", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-find-"));
    const dir = join(mechaDir, "alice");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "config.json"), JSON.stringify({ port: 7700, token: "t", workspace: "/ws" }));

    const info: ProcessInfo = { name: "alice" as BotName, state: "stopped", workspacePath: "/ws", port: undefined };
    const deps = makeDeps({
      mechaDir,
      pm: { list: vi.fn().mockReturnValue([info]) },
    });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "find"]);
    expect(deps.formatter.table).toHaveBeenCalledWith(
      ["Name", "State", "Port", "Tags"],
      [["alice", "stopped", "-", "-"]],
    );
  });

  it("filters with AND logic across multiple --tag flags", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-find-"));
    writeBotConfig("alice", ["code", "typescript"]);
    writeBotConfig("bob", ["code", "review"]);

    const deps = makeDeps({
      mechaDir,
      pm: { list: vi.fn().mockReturnValue([makeInfo("alice", 7701), makeInfo("bob", 7702)]) },
    });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "find", "--tag", "code", "--tag", "review"]);
    expect(deps.formatter.table).toHaveBeenCalledWith(
      ["Name", "State", "Port", "Tags"],
      [["bob", "running", "7702", "code, review"]],
    );
  });
});
