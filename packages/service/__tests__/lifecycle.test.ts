import { describe, it, expect, vi } from "vitest";
import { Readable } from "node:stream";
import { casaSpawn, casaLs, casaStatus, casaKill, casaStop, casaLogs } from "../src/lifecycle.js";
import { CasaNotFoundError } from "@mecha/contracts";
import type { CasaName } from "@mecha/core";
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

describe("casaSpawn", () => {
  it("delegates to ProcessManager.spawn", async () => {
    const pm = createMockPM({
      spawn: vi.fn().mockResolvedValue(RUNNING_INFO),
    });

    const result = await casaSpawn(pm, {
      name: CASA_NAME,
      workspacePath: "/workspace",
    });
    expect(result).toEqual(RUNNING_INFO);
    expect(pm.spawn).toHaveBeenCalledWith({
      name: CASA_NAME,
      workspacePath: "/workspace",
    });
  });
});

describe("casaLs", () => {
  it("returns list from ProcessManager", () => {
    const pm = createMockPM({
      list: vi.fn().mockReturnValue([RUNNING_INFO]),
    });

    const result = casaLs(pm);
    expect(result).toEqual([RUNNING_INFO]);
  });

  it("returns empty list when no CASAs", () => {
    const pm = createMockPM();
    expect(casaLs(pm)).toEqual([]);
  });
});

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

describe("casaKill", () => {
  it("delegates to ProcessManager.kill", async () => {
    const pm = createMockPM({
      kill: vi.fn().mockResolvedValue(undefined),
    });

    await casaKill(pm, CASA_NAME);
    expect(pm.kill).toHaveBeenCalledWith(CASA_NAME);
  });
});

describe("casaStop", () => {
  it("delegates to ProcessManager.stop", async () => {
    const pm = createMockPM({
      stop: vi.fn().mockResolvedValue(undefined),
    });

    await casaStop(pm, CASA_NAME);
    expect(pm.stop).toHaveBeenCalledWith(CASA_NAME);
  });
});

describe("casaLogs", () => {
  it("returns readable stream from ProcessManager", () => {
    const stream = new Readable({ read() { this.push(null); } });
    const pm = createMockPM({
      logs: vi.fn().mockReturnValue(stream),
    });

    const result = casaLogs(pm, CASA_NAME);
    expect(result).toBe(stream);
  });

  it("passes log options", () => {
    const stream = new Readable({ read() { this.push(null); } });
    const pm = createMockPM({
      logs: vi.fn().mockReturnValue(stream),
    });

    casaLogs(pm, CASA_NAME, { follow: true, tail: 50 });
    expect(pm.logs).toHaveBeenCalledWith(CASA_NAME, { follow: true, tail: 50 });
  });
});
