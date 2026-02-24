import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  mechaAuthAdd,
  mechaAuthLs,
  mechaAuthDefault,
  mechaAuthRm,
  mechaAuthTag,
  mechaAuthSwitch,
  mechaAuthTest,
  mechaAuthRenew,
  mechaAuthGet,
  mechaAuthGetDefault,
} from "../src/auth.js";
import { AuthProfileNotFoundError } from "@mecha/core";

describe("auth service", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  function setup(): string {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-auth-test-"));
    mkdirSync(join(tempDir, "auth"), { recursive: true });
    return tempDir;
  }

  describe("mechaAuthAdd", () => {
    it("adds first profile as default", () => {
      const dir = setup();
      const profile = mechaAuthAdd(dir, "personal", "oauth", "tok-123");
      expect(profile.name).toBe("personal");
      expect(profile.type).toBe("oauth");
      expect(profile.isDefault).toBe(true);
      expect(profile.tags).toEqual([]);
    });

    it("adds subsequent profiles as non-default", () => {
      const dir = setup();
      mechaAuthAdd(dir, "personal", "oauth", "tok-123");
      const second = mechaAuthAdd(dir, "work", "api-key", "sk-abc");
      expect(second.isDefault).toBe(false);
    });

    it("adds profile with tags", () => {
      const dir = setup();
      const profile = mechaAuthAdd(dir, "tagged", "oauth", "tok-123", ["research", "coding"]);
      expect(profile.tags).toEqual(["research", "coding"]);
    });

    it("throws on duplicate name", () => {
      const dir = setup();
      mechaAuthAdd(dir, "dup", "oauth", "tok");
      expect(() => mechaAuthAdd(dir, "dup", "oauth", "tok2")).toThrow("already exists");
    });
  });

  describe("mechaAuthLs", () => {
    it("returns empty list when no profiles", () => {
      const dir = setup();
      expect(mechaAuthLs(dir)).toEqual([]);
    });

    it("returns all profiles", () => {
      const dir = setup();
      mechaAuthAdd(dir, "a", "oauth", "tok1");
      mechaAuthAdd(dir, "b", "api-key", "tok2");
      expect(mechaAuthLs(dir)).toHaveLength(2);
    });
  });

  describe("mechaAuthDefault", () => {
    it("sets a profile as default", () => {
      const dir = setup();
      mechaAuthAdd(dir, "a", "oauth", "tok1");
      mechaAuthAdd(dir, "b", "api-key", "tok2");

      mechaAuthDefault(dir, "b");
      const profiles = mechaAuthLs(dir);
      expect(profiles.find((p) => p.name === "b")!.isDefault).toBe(true);
      expect(profiles.find((p) => p.name === "a")!.isDefault).toBe(false);
    });

    it("throws AuthProfileNotFoundError for unknown profile", () => {
      const dir = setup();
      expect(() => mechaAuthDefault(dir, "nope")).toThrow(AuthProfileNotFoundError);
    });
  });

  describe("mechaAuthRm", () => {
    it("removes a profile", () => {
      const dir = setup();
      mechaAuthAdd(dir, "rm-me", "oauth", "tok");
      mechaAuthRm(dir, "rm-me");
      expect(mechaAuthLs(dir)).toEqual([]);
    });

    it("promotes next profile to default when removing default", () => {
      const dir = setup();
      mechaAuthAdd(dir, "a", "oauth", "tok1");
      mechaAuthAdd(dir, "b", "api-key", "tok2");
      mechaAuthRm(dir, "a");

      const profiles = mechaAuthLs(dir);
      expect(profiles).toHaveLength(1);
      expect(profiles[0].isDefault).toBe(true);
    });

    it("handles removing last profile", () => {
      const dir = setup();
      mechaAuthAdd(dir, "only", "oauth", "tok");
      mechaAuthRm(dir, "only");
      expect(mechaAuthLs(dir)).toEqual([]);
      expect(mechaAuthGetDefault(dir)).toBeUndefined();
    });

    it("throws AuthProfileNotFoundError for unknown profile", () => {
      const dir = setup();
      expect(() => mechaAuthRm(dir, "nope")).toThrow(AuthProfileNotFoundError);
    });
  });

  describe("mechaAuthTag", () => {
    it("sets tags on a profile", () => {
      const dir = setup();
      mechaAuthAdd(dir, "tagged", "oauth", "tok");
      mechaAuthTag(dir, "tagged", ["research", "coding"]);
      expect(mechaAuthGet(dir, "tagged")!.tags).toEqual(["research", "coding"]);
    });

    it("throws AuthProfileNotFoundError for unknown profile", () => {
      const dir = setup();
      expect(() => mechaAuthTag(dir, "nope", ["tag"])).toThrow(AuthProfileNotFoundError);
    });
  });

  describe("mechaAuthSwitch", () => {
    it("switches default profile", () => {
      const dir = setup();
      mechaAuthAdd(dir, "a", "oauth", "tok1");
      mechaAuthAdd(dir, "b", "api-key", "tok2");
      const result = mechaAuthSwitch(dir, "b");
      expect(result.isDefault).toBe(true);
      expect(mechaAuthGetDefault(dir)!.name).toBe("b");
    });

    it("throws AuthProfileNotFoundError for unknown profile", () => {
      const dir = setup();
      expect(() => mechaAuthSwitch(dir, "nope")).toThrow(AuthProfileNotFoundError);
    });
  });

  describe("mechaAuthTest", () => {
    it("validates non-empty token", () => {
      const dir = setup();
      mechaAuthAdd(dir, "valid", "oauth", "tok-123");
      const result = mechaAuthTest(dir, "valid");
      expect(result.valid).toBe(true);
      expect(result.profile.name).toBe("valid");
    });

    it("invalidates empty token", () => {
      const dir = setup();
      mechaAuthAdd(dir, "empty", "oauth", "tok");
      mechaAuthRenew(dir, "empty", "");
      const result = mechaAuthTest(dir, "empty");
      expect(result.valid).toBe(false);
    });

    it("throws AuthProfileNotFoundError for unknown profile", () => {
      const dir = setup();
      expect(() => mechaAuthTest(dir, "nope")).toThrow(AuthProfileNotFoundError);
    });
  });

  describe("mechaAuthRenew", () => {
    it("updates token", () => {
      const dir = setup();
      mechaAuthAdd(dir, "renew-me", "oauth", "old-tok");
      const result = mechaAuthRenew(dir, "renew-me", "new-tok");
      expect(result.token).toBe("new-tok");
      expect(mechaAuthGet(dir, "renew-me")!.token).toBe("new-tok");
    });

    it("throws AuthProfileNotFoundError for unknown profile", () => {
      const dir = setup();
      expect(() => mechaAuthRenew(dir, "nope", "tok")).toThrow(AuthProfileNotFoundError);
    });
  });

  describe("mechaAuthGet", () => {
    it("returns profile by name", () => {
      const dir = setup();
      mechaAuthAdd(dir, "find-me", "oauth", "tok");
      const profile = mechaAuthGet(dir, "find-me");
      expect(profile?.name).toBe("find-me");
    });

    it("returns undefined for unknown", () => {
      const dir = setup();
      expect(mechaAuthGet(dir, "nope")).toBeUndefined();
    });
  });

  describe("mechaAuthGetDefault", () => {
    it("returns default profile", () => {
      const dir = setup();
      mechaAuthAdd(dir, "default-one", "oauth", "tok");
      expect(mechaAuthGetDefault(dir)!.name).toBe("default-one");
    });

    it("returns undefined when no profiles", () => {
      const dir = setup();
      expect(mechaAuthGetDefault(dir)).toBeUndefined();
    });
  });

  describe("mechaAuthRm — non-default with others remaining", () => {
    it("does not promote when removed profile was not default", () => {
      const dir = setup();
      mechaAuthAdd(dir, "a", "oauth", "tok1"); // default
      mechaAuthAdd(dir, "b", "api-key", "tok2"); // not default
      mechaAuthRm(dir, "b");

      const profiles = mechaAuthLs(dir);
      expect(profiles).toHaveLength(1);
      expect(profiles[0].name).toBe("a");
      expect(profiles[0].isDefault).toBe(true);
    });
  });

  describe("readStore resilience", () => {
    it("handles missing auth dir gracefully", () => {
      tempDir = mkdtempSync(join(tmpdir(), "mecha-auth-test-"));
      // No auth dir at all
      expect(mechaAuthLs(tempDir)).toEqual([]);
    });

    it("handles malformed profiles.json", () => {
      tempDir = mkdtempSync(join(tmpdir(), "mecha-auth-test-"));
      mkdirSync(join(tempDir, "auth"), { recursive: true });
      writeFileSync(join(tempDir, "auth", "profiles.json"), "not-json{{{");
      expect(mechaAuthLs(tempDir)).toEqual([]);
    });
  });
});
