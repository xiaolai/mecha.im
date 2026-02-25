import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createLocator } from "../src/locator.js";
import type { CasaName, NodeName, NodeEntry } from "@mecha/core";
import type { ProcessInfo } from "@mecha/process";
import { writeCasaConfig } from "../../core/__tests__/test-utils.js";
import { makePm } from "./test-utils.js";

describe("createLocator", () => {
  let mechaDir: string;
  afterEach(() => { if (mechaDir) rmSync(mechaDir, { recursive: true, force: true }); });

  describe("local targets", () => {
    it("finds running local CASA", () => {
      mechaDir = mkdtempSync(join(tmpdir(), "locator-"));
      writeCasaConfig(mechaDir, "alice", { port: 7700, token: "tok", workspace: "/ws" });

      const pm = makePm([{ name: "alice" as CasaName, state: "running", port: 7700, workspacePath: "/ws" }]);
      const locator = createLocator({ mechaDir, pm, getNodes: () => [] });

      const result = locator.locate({ casa: "alice" as CasaName, node: "local" as NodeName });
      expect(result).toEqual({ location: "local", port: 7700, token: "tok" });
    });

    it("returns not_found for stopped local CASA (stale port/token)", () => {
      mechaDir = mkdtempSync(join(tmpdir(), "locator-"));
      writeCasaConfig(mechaDir, "alice", { port: 7700, token: "tok", workspace: "/ws" });

      const pm = makePm();
      const locator = createLocator({ mechaDir, pm, getNodes: () => [] });

      const result = locator.locate({ casa: "alice" as CasaName, node: "local" as NodeName });
      expect(result).toEqual({ location: "not_found" });
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
