import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { casaConfigure } from "../src/casa.js";
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
    getPortAndToken: vi.fn(),
    onEvent: vi.fn().mockReturnValue(() => {}),
    ...overrides,
  } as ProcessManager;
}

describe("casaConfigure", () => {
  let mechaDir: string;
  afterEach(() => { if (mechaDir) rmSync(mechaDir, { recursive: true, force: true }); });

  it("updates tags", () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-cfg-"));
    const casaDir = join(mechaDir, "alice");
    mkdirSync(casaDir, { recursive: true });
    writeFileSync(join(casaDir, "config.json"), JSON.stringify({ port: 7700, token: "t", workspace: "/ws" }));

    const info: ProcessInfo = { name: "alice" as CasaName, state: "running", workspacePath: "/ws", port: 7700 };
    const pm = createMockPM({ get: vi.fn().mockReturnValue(info) });

    casaConfigure(mechaDir, pm, "alice" as CasaName, { tags: ["research", "papers"] });

    const cfg = JSON.parse(readFileSync(join(casaDir, "config.json"), "utf-8"));
    expect(cfg.tags).toEqual(["research", "papers"]);
    expect(cfg.port).toBe(7700);
  });

  it("throws CasaNotFoundError for unknown CASA", () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-cfg-"));
    const pm = createMockPM();
    expect(() => casaConfigure(mechaDir, pm, "unknown" as CasaName, { tags: ["x"] })).toThrow(CasaNotFoundError);
  });
});
