import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createLocator } from "../src/locator.js";
import type { BotName, NodeName, NodeEntry } from "@mecha/core";
import type { ProcessInfo } from "@mecha/process";
import { writeBotConfig } from "../../core/__tests__/test-utils.js";
import { makePm } from "./test-utils.js";

describe("createLocator", () => {
  let mechaDir: string;
  afterEach(() => { if (mechaDir) rmSync(mechaDir, { recursive: true, force: true }); });

  describe("local targets", () => {
    it("finds running local bot", () => {
      mechaDir = mkdtempSync(join(tmpdir(), "locator-"));
      writeBotConfig(mechaDir, "alice", { port: 7700, token: "tok", workspace: "/ws" });

      const pm = makePm([{ name: "alice" as BotName, state: "running", port: 7700, workspacePath: "/ws" }]);
      const locator = createLocator({ mechaDir, pm, getNodes: () => [] });

      const result = locator.locate({ bot: "alice" as BotName, node: "local" as NodeName });
      expect(result).toEqual({ location: "local", port: 7700, token: "tok" });
    });

    it("returns not_found for stopped local bot (stale port/token)", () => {
      mechaDir = mkdtempSync(join(tmpdir(), "locator-"));
      writeBotConfig(mechaDir, "alice", { port: 7700, token: "tok", workspace: "/ws" });

      const pm = makePm();
      const locator = createLocator({ mechaDir, pm, getNodes: () => [] });

      const result = locator.locate({ bot: "alice" as BotName, node: "local" as NodeName });
      expect(result).toEqual({ location: "not_found" });
    });

    it("returns not_found when no config", () => {
      mechaDir = mkdtempSync(join(tmpdir(), "locator-"));
      const pm = makePm();
      const locator = createLocator({ mechaDir, pm, getNodes: () => [] });

      const result = locator.locate({ bot: "ghost" as BotName, node: "local" as NodeName });
      expect(result).toEqual({ location: "not_found" });
    });
  });

  describe("remote targets", () => {
    it("finds remote bot via node registry", () => {
      mechaDir = mkdtempSync(join(tmpdir(), "locator-"));
      const bobNode: NodeEntry = {
        name: "bob", host: "192.168.1.10", port: 7660,
        apiKey: "key", addedAt: "2026-01-01T00:00:00Z",
      };
      const pm = makePm();
      const locator = createLocator({ mechaDir, pm, getNodes: () => [bobNode] });

      const result = locator.locate({ bot: "analyst" as BotName, node: "bob" as NodeName });
      expect(result).toEqual({ location: "remote", node: bobNode });
    });

    it("returns not_found when node not registered", () => {
      mechaDir = mkdtempSync(join(tmpdir(), "locator-"));
      const pm = makePm();
      const locator = createLocator({ mechaDir, pm, getNodes: () => [] });

      const result = locator.locate({ bot: "analyst" as BotName, node: "unknown" as NodeName });
      expect(result).toEqual({ location: "not_found" });
    });

    it("returns remote-channel for managed node (Phase 6)", () => {
      mechaDir = mkdtempSync(join(tmpdir(), "locator-"));
      const managedNode: NodeEntry = {
        name: "charlie", host: "", port: 0, apiKey: "",
        publicKey: "pk", noisePublicKey: "npk", fingerprint: "fp",
        addedAt: "2026-01-01T00:00:00Z", managed: true,
      };
      const pm = makePm();
      const locator = createLocator({ mechaDir, pm, getNodes: () => [managedNode] });

      const result = locator.locate({ bot: "coder" as BotName, node: "charlie" as NodeName });
      expect(result).toEqual({ location: "remote-channel", node: managedNode });
    });
  });
});
