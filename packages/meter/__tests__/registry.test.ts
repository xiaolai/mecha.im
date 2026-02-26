import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scanCasaRegistry, lookupCasa } from "../src/registry.js";

describe("registry", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  describe("scanCasaRegistry", () => {
    it("returns empty for non-existent directory", () => {
      const registry = scanCasaRegistry("/nonexistent/path");
      expect(registry.size).toBe(0);
    });

    it("scans config.json from CASA directories", () => {
      tempDir = mkdtempSync(join(tmpdir(), "meter-registry-"));
      const researcherDir = join(tempDir, "researcher");
      mkdirSync(researcherDir);
      writeFileSync(join(researcherDir, "config.json"), JSON.stringify({
        workspace: "/home/user/research",
        auth: "personal",
        tags: ["research", "ml"],
      }));

      const coderDir = join(tempDir, "coder");
      mkdirSync(coderDir);
      writeFileSync(join(coderDir, "config.json"), JSON.stringify({
        workspace: "/home/user/code",
        tags: ["code"],
      }));

      const registry = scanCasaRegistry(tempDir);
      expect(registry.size).toBe(2);

      const researcher = registry.get("researcher")!;
      expect(researcher.workspace).toBe("/home/user/research");
      expect(researcher.authProfile).toBe("personal");
      expect(researcher.tags).toEqual(["research", "ml"]);

      const coder = registry.get("coder")!;
      expect(coder.authProfile).toBe("unknown");
    });

    it("skips directories without valid config.json", () => {
      tempDir = mkdtempSync(join(tmpdir(), "meter-registry-"));
      mkdirSync(join(tempDir, "valid"));
      writeFileSync(join(tempDir, "valid", "config.json"), JSON.stringify({
        workspace: "/ws",
      }));

      // Dir without config.json
      mkdirSync(join(tempDir, "no-config"));

      // File (not directory)
      writeFileSync(join(tempDir, "meter"), "not a dir");

      // Dir with invalid JSON
      mkdirSync(join(tempDir, "bad-json"));
      writeFileSync(join(tempDir, "bad-json", "config.json"), "not json");

      // Dir with config but no workspace
      mkdirSync(join(tempDir, "no-workspace"));
      writeFileSync(join(tempDir, "no-workspace", "config.json"), '{"port":7700}');

      const registry = scanCasaRegistry(tempDir);
      expect(registry.size).toBe(1);
      expect(registry.has("valid")).toBe(true);
    });

    it("filters non-string tags", () => {
      tempDir = mkdtempSync(join(tmpdir(), "meter-registry-"));
      mkdirSync(join(tempDir, "casa"));
      writeFileSync(join(tempDir, "casa", "config.json"), JSON.stringify({
        workspace: "/ws",
        tags: ["valid", 123, null, "also-valid"],
      }));

      const registry = scanCasaRegistry(tempDir);
      expect(registry.get("casa")!.tags).toEqual(["valid", "also-valid"]);
    });
  });

  describe("lookupCasa", () => {
    it("returns entry for known CASA", () => {
      const registry = new Map();
      registry.set("researcher", {
        name: "researcher", authProfile: "work",
        workspace: "/ws", tags: ["research"],
      });

      const entry = lookupCasa(registry, "researcher");
      expect(entry.authProfile).toBe("work");
    });

    it("returns defaults for unknown CASA", () => {
      const registry = new Map();
      const entry = lookupCasa(registry, "unknown-casa");
      expect(entry.name).toBe("unknown-casa");
      expect(entry.authProfile).toBe("unknown");
      expect(entry.workspace).toBe("unknown");
      expect(entry.tags).toEqual([]);
    });
  });
});
