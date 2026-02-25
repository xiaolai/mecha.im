import { describe, it, expect, vi } from "vitest";
import { casaStatus } from "../src/casa.js";
import { CasaNotFoundError, type CasaName } from "@mecha/core";
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

const CASA_NAME = "test" as CasaName;

const RUNNING_INFO: ProcessInfo = {
  name: CASA_NAME,
  state: "running",
  pid: 12345,
  port: 7700,
  workspacePath: "/workspace",
  token: "tok",
  startedAt: "2026-01-01T00:00:00Z",
};

describe("casaStatus", () => {
  it("returns info for existing CASA", () => {
    const pm = createMockPM({
      get: vi.fn().mockReturnValue(RUNNING_INFO),
    });

    const result = casaStatus(pm, CASA_NAME);
    expect(result).toEqual(RUNNING_INFO);
  });

  it("throws CasaNotFoundError for unknown CASA", () => {
    const pm = createMockPM();
    expect(() => casaStatus(pm, CASA_NAME)).toThrow(CasaNotFoundError);
  });
});
