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
      expect(config).toEqual({ totp: true });
    });

    it("reads config from file", () => {
      writeFileSync(join(dir, "auth-config.json"), JSON.stringify({ totp: false }));
      const config = readAuthConfig(dir);
      expect(config).toEqual({ totp: false });
    });

    it("fills missing fields with defaults", () => {
      writeFileSync(join(dir, "auth-config.json"), JSON.stringify({}));
      const config = readAuthConfig(dir);
      expect(config).toEqual({ totp: true });
    });

    it("uses defaults for non-boolean field values", () => {
      writeFileSync(join(dir, "auth-config.json"), JSON.stringify({ totp: "yes" }));
      const config = readAuthConfig(dir);
      expect(config).toEqual({ totp: true });
    });

    it("handles corrupt JSON", () => {
      writeFileSync(join(dir, "auth-config.json"), "not json");
      const config = readAuthConfig(dir);
      expect(config).toEqual({ totp: true });
    });
  });

  describe("writeAuthConfig", () => {
    it("writes config to file", () => {
      writeAuthConfig(dir, { totp: true });
      const content = JSON.parse(readFileSync(join(dir, "auth-config.json"), "utf-8"));
      expect(content).toEqual({ totp: true });
    });

    it("throws when TOTP disabled", () => {
      expect(() => writeAuthConfig(dir, { totp: false })).toThrow(
        "TOTP must be enabled",
      );
    });

    it("creates parent directory if needed", () => {
      const nested = join(dir, "nested");
      writeAuthConfig(nested, { totp: true });
      expect(JSON.parse(readFileSync(join(nested, "auth-config.json"), "utf-8"))).toEqual({
        totp: true,
      });
    });
  });

  describe("resolveAuthConfig", () => {
    it("returns file config when no overrides", () => {
      writeFileSync(join(dir, "auth-config.json"), JSON.stringify({ totp: true }));
      const config = resolveAuthConfig(dir);
      expect(config).toEqual({ totp: true });
    });

    it("applies overrides over file config", () => {
      writeFileSync(join(dir, "auth-config.json"), JSON.stringify({ totp: false }));
      const config = resolveAuthConfig(dir, { totp: true });
      expect(config).toEqual({ totp: true });
    });

    it("throws when overrides result in TOTP disabled", () => {
      writeFileSync(join(dir, "auth-config.json"), JSON.stringify({ totp: true }));
      expect(() => resolveAuthConfig(dir, { totp: false })).toThrow(
        "TOTP must be enabled",
      );
    });
  });
});
