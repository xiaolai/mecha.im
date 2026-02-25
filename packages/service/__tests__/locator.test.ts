import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createLocator } from "../src/locator.js";
import type { CasaAddress, CasaName, NodeName, NodeEntry } from "@mecha/core";
import type { ProcessManager, ProcessInfo } from "@mecha/process";

function writeCasaConfig(mechaDir: string, name: string, cfg: Record<string, unknown>): void {
  const dir = join(mechaDir, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "config.json"), JSON.stringify(cfg));
}

function makePm(infos: Record<string, Partial<ProcessInfo>> = {}): ProcessManager {
  return {
    spawn: vi.fn(),
    get: vi.fn().mockImplementation((name: string) => infos[name] ?? undefined),
    list: vi.fn().mockReturnValue(Object.values(infos)),
    stop: vi.fn(),
    kill: vi.fn(),
    logs: vi.fn(),
    getPortAndToken: vi.fn(),
    onEvent: vi.fn().mockReturnValue(() => {}),
  } as unknown as ProcessManager;
}

describe("createLocator", () => {
  let mechaDir: string;
  afterEach(() => { if (mechaDir) rmSync(mechaDir, { recursive: true, force: true }); });

  describe("local targets", () => {
    it("finds running local CASA", () => {
      mechaDir = mkdtempSync(join(tmpdir(), "locator-"));
      writeCasaConfig(mechaDir, "alice", { port: 7700, token: "tok", workspace: "/ws" });

      const pm = makePm({ alice: { name: "alice" as CasaName, state: "running", port: 7700 } });
      const locator = createLocator({ mechaDir, pm, getNodes: () => [] });

      const result = locator.locate({ casa: "alice" as CasaName, node: "local" as NodeName });
      expect(result).toEqual({ location: "local", port: 7700, token: "tok" });
    });

    it("finds stopped local CASA with config", () => {
      mechaDir = mkdtempSync(join(tmpdir(), "locator-"));
      writeCasaConfig(mechaDir, "alice", { port: 7700, token: "tok", workspace: "/ws" });

      const pm = makePm();
      const locator = createLocator({ mechaDir, pm, getNodes: () => [] });

      const result = locator.locate({ casa: "alice" as CasaName, node: "local" as NodeName });
      expect(result).toEqual({ location: "local", port: 7700, token: "tok" });
    });

    it("returns not_found when no config", () => {
      mechaDir = mkdtempSync(join(tmpdir(), "locator-"));
      const pm = makePm();
      const locator = createLocator({ mechaDir, pm, getNodes: () => [] });

      const result = locator.locate({ casa: "ghost" as CasaName, node: "local" as NodeName });
      expect(result).toEqual({ location: "not_found" });
    });
  });

  describe("remote targets", () => {
    it("finds remote CASA via node registry", () => {
      mechaDir = mkdtempSync(join(tmpdir(), "locator-"));
      const bobNode: NodeEntry = {
        name: "bob", host: "192.168.1.10", port: 7660,
        apiKey: "key", addedAt: "2026-01-01T00:00:00Z",
      };
      const pm = makePm();
      const locator = createLocator({ mechaDir, pm, getNodes: () => [bobNode] });

      const result = locator.locate({ casa: "analyst" as CasaName, node: "bob" as NodeName });
      expect(result).toEqual({ location: "remote", node: bobNode });
    });

    it("returns not_found when node not registered", () => {
      mechaDir = mkdtempSync(join(tmpdir(), "locator-"));
      const pm = makePm();
      const locator = createLocator({ mechaDir, pm, getNodes: () => [] });

      const result = locator.locate({ casa: "analyst" as CasaName, node: "unknown" as NodeName });
      expect(result).toEqual({ location: "not_found" });
    });
  });
});
