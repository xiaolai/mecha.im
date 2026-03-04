import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { botConfigure } from "../src/bot.js";
import { BotNotFoundError, type BotName } from "@mecha/core";
import type { ProcessManager, ProcessInfo } from "@mecha/process";

function createMockPM(overrides: Partial<ProcessManager> = {}): ProcessManager {
  return {
    spawn: vi.fn(),
    get: vi.fn().mockReturnValue(undefined),
    list: vi.fn().mockReturnValue([]),
    stop: vi.fn(),
    kill: vi.fn(),
    logs: vi.fn(),
    getPortAndToken: vi.fn(),
    onEvent: vi.fn().mockReturnValue(() => {}),
    ...overrides,
  } as ProcessManager;
}

describe("botConfigure", () => {
  let mechaDir: string;
  afterEach(() => { if (mechaDir) rmSync(mechaDir, { recursive: true, force: true }); });

  it("updates tags", () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-cfg-"));
    const botDir = join(mechaDir, "alice");
    mkdirSync(botDir, { recursive: true });
    writeFileSync(join(botDir, "config.json"), JSON.stringify({ port: 7700, token: "t", workspace: "/ws" }));

    const info: ProcessInfo = { name: "alice" as BotName, state: "running", workspacePath: "/ws", port: 7700 };
    const pm = createMockPM({ get: vi.fn().mockReturnValue(info) });

    botConfigure(mechaDir, pm, "alice" as BotName, { tags: ["research", "papers"] });

    const cfg = JSON.parse(readFileSync(join(botDir, "config.json"), "utf-8"));
    expect(cfg.tags).toEqual(["research", "papers"]);
    expect(cfg.port).toBe(7700);
  });

  it("throws BotNotFoundError for unknown bot", () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-cfg-"));
    const pm = createMockPM();
    expect(() => botConfigure(mechaDir, pm, "unknown" as BotName, { tags: ["x"] })).toThrow(BotNotFoundError);
  });
});
