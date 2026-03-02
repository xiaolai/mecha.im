import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readAuthConfig, writeAuthConfig, resolveAuthConfig } from "../src/auth-config.js";

describe("auth-config", () => {
  let dir: string;

  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "authcfg-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  describe("readAuthConfig", () => {
    it("returns defaults when no file exists", () => {
      const config = readAuthConfig(dir);
      expect(config).toEqual({ totp: true, apiKey: false });
    });

    it("reads config from file", () => {
      writeFileSync(join(dir, "auth-config.json"), JSON.stringify({ totp: false, apiKey: true }));
      const config = readAuthConfig(dir);
      expect(config).toEqual({ totp: false, apiKey: true });
    });

    it("fills missing fields with defaults", () => {
      writeFileSync(join(dir, "auth-config.json"), JSON.stringify({ apiKey: true }));
      const config = readAuthConfig(dir);
      expect(config).toEqual({ totp: true, apiKey: true });
    });

    it("uses defaults for non-boolean field values", () => {
      writeFileSync(join(dir, "auth-config.json"), JSON.stringify({ totp: true, apiKey: "yes" }));
      const config = readAuthConfig(dir);
      expect(config).toEqual({ totp: true, apiKey: false });
    });

    it("handles corrupt JSON", () => {
      writeFileSync(join(dir, "auth-config.json"), "not json");
      const config = readAuthConfig(dir);
      expect(config).toEqual({ totp: true, apiKey: false });
    });
  });

  describe("writeAuthConfig", () => {
    it("writes config to file", () => {
      writeAuthConfig(dir, { totp: true, apiKey: true });
      const content = JSON.parse(readFileSync(join(dir, "auth-config.json"), "utf-8"));
      expect(content).toEqual({ totp: true, apiKey: true });
    });

    it("throws when both methods disabled", () => {
      expect(() => writeAuthConfig(dir, { totp: false, apiKey: false })).toThrow(
        "At least one auth method must be enabled",
      );
    });

    it("creates parent directory if needed", () => {
      const nested = join(dir, "nested");
      writeAuthConfig(nested, { totp: true, apiKey: false });
      expect(JSON.parse(readFileSync(join(nested, "auth-config.json"), "utf-8"))).toEqual({
        totp: true, apiKey: false,
      });
    });
  });

  describe("resolveAuthConfig", () => {
    it("returns file config when no overrides", () => {
      writeFileSync(join(dir, "auth-config.json"), JSON.stringify({ totp: true, apiKey: true }));
      const config = resolveAuthConfig(dir);
      expect(config).toEqual({ totp: true, apiKey: true });
    });

    it("applies overrides over file config", () => {
      writeFileSync(join(dir, "auth-config.json"), JSON.stringify({ totp: true, apiKey: false }));
      const config = resolveAuthConfig(dir, { apiKey: true });
      expect(config).toEqual({ totp: true, apiKey: true });
    });

    it("throws when overrides result in both disabled", () => {
      writeFileSync(join(dir, "auth-config.json"), JSON.stringify({ totp: true, apiKey: false }));
      expect(() => resolveAuthConfig(dir, { totp: false })).toThrow(
        "At least one auth method must be enabled",
      );
    });
  });
});
