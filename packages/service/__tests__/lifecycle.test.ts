import { describe, it, expect, vi } from "vitest";
import { botStatus } from "../src/bot.js";
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
    getPortAndToken: vi.fn().mockReturnValue(undefined),
    onEvent: vi.fn().mockReturnValue(() => {}),
    ...overrides,
  } as ProcessManager;
}

const BOT_NAME = "test" as BotName;

const RUNNING_INFO: ProcessInfo = {
  name: BOT_NAME,
  state: "running",
  pid: 12345,
  port: 7700,
  workspacePath: "/workspace",
  token: "tok",
  startedAt: "2026-01-01T00:00:00Z",
};

describe("botStatus", () => {
  it("returns info for existing bot", () => {
    const pm = createMockPM({
      get: vi.fn().mockReturnValue(RUNNING_INFO),
    });

    const result = botStatus(pm, BOT_NAME);
    expect(result).toEqual(RUNNING_INFO);
  });

  it("throws BotNotFoundError for unknown bot", () => {
    const pm = createMockPM();
    expect(() => botStatus(pm, BOT_NAME)).toThrow(BotNotFoundError);
  });
});
