import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
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
  mechaAuthSwitchBot,
  mechaAuthProbe,
} from "../src/auth.js";
import { AuthProfileNotFoundError, BotNotFoundError, InvalidNameError, readAuthCredentials } from "@mecha/core";
import type { BotName } from "@mecha/core";
import type { ProcessManager, ProcessInfo } from "@mecha/process";

describe("auth service", () => {
  let tempDir: string;
  let savedApiKey: string | undefined;
  let savedOauth: string | undefined;

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    // Restore env vars cleared during setup
    if (savedApiKey !== undefined) process.env.ANTHROPIC_API_KEY = savedApiKey;
    else delete process.env.ANTHROPIC_API_KEY;
    if (savedOauth !== undefined) process.env.CLAUDE_CODE_OAUTH_TOKEN = savedOauth;
    else delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
  });

  function setup(): string {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-auth-test-"));
    mkdirSync(join(tempDir, "auth"), { recursive: true });
    // Clear env vars so synthetic env profiles don't interfere with counts
    savedApiKey = process.env.ANTHROPIC_API_KEY;
    savedOauth = process.env.CLAUDE_CODE_OAUTH_TOKEN;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
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

    it("stores token in credentials.json separately", () => {
      const dir = setup();
      mechaAuthAdd(dir, "personal", "oauth", "tok-123");
      const creds = readAuthCredentials(dir);
      expect(creds.personal.token).toBe("tok-123");
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

    it("throws InvalidNameError for reserved name", () => {
      const dir = setup();
      expect(() => mechaAuthAdd(dir, "__proto__", "oauth", "tok")).toThrow(InvalidNameError);
    });

    it("throws InvalidNameError for invalid format", () => {
      const dir = setup();
      expect(() => mechaAuthAdd(dir, "UPPERCASE", "oauth", "tok")).toThrow(InvalidNameError);
    });

    it("throws on duplicate name", () => {
      const dir = setup();
      mechaAuthAdd(dir, "dup", "oauth", "tok");
      expect(() => mechaAuthAdd(dir, "dup", "oauth", "tok2")).toThrow("already exists");
    });

    it("sets account and label via mechaAuthAddFull", async () => {
      const dir = setup();
      const { mechaAuthAddFull } = await import("../src/auth.js");
      const profile = mechaAuthAddFull(dir, {
        name: "full",
        type: "oauth",
        token: "tok",
        account: "user@example.com",
        label: "My Account",
        expiresAt: 1771891200000,
      });
      expect(profile.account).toBe("user@example.com");
      expect(profile.label).toBe("My Account");
      expect(profile.expiresAt).toBe(1771891200000);
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

    it("includes account and expiresAt fields", () => {
      const dir = setup();
      mechaAuthAdd(dir, "a", "oauth", "tok1");
      const profiles = mechaAuthLs(dir);
      expect(profiles[0]).toHaveProperty("account");
      expect(profiles[0]).toHaveProperty("expiresAt");
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

    it("removes credentials too", () => {
      const dir = setup();
      mechaAuthAdd(dir, "rm-me", "oauth", "tok");
      mechaAuthRm(dir, "rm-me");
      const creds = readAuthCredentials(dir);
      expect(creds["rm-me"]).toBeUndefined();
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
    it("updates token in credentials", () => {
      const dir = setup();
      mechaAuthAdd(dir, "renew-me", "oauth", "old-tok");
      mechaAuthRenew(dir, "renew-me", "new-tok");
      const creds = readAuthCredentials(dir);
      expect(creds["renew-me"].token).toBe("new-tok");
    });

    it("returns profile with correct name", () => {
      const dir = setup();
      mechaAuthAdd(dir, "renew-me", "oauth", "old-tok");
      const result = mechaAuthRenew(dir, "renew-me", "new-tok");
      expect(result.name).toBe("renew-me");
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
      savedApiKey = process.env.ANTHROPIC_API_KEY;
      savedOauth = process.env.CLAUDE_CODE_OAUTH_TOKEN;
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
      // No auth dir at all
      expect(mechaAuthLs(tempDir)).toEqual([]);
    });

    it("handles malformed profiles.json", () => {
      tempDir = mkdtempSync(join(tmpdir(), "mecha-auth-test-"));
      savedApiKey = process.env.ANTHROPIC_API_KEY;
      savedOauth = process.env.CLAUDE_CODE_OAUTH_TOKEN;
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
      mkdirSync(join(tempDir, "auth"), { recursive: true });
      writeFileSync(join(tempDir, "auth", "profiles.json"), "not-json{{{");
      expect(mechaAuthLs(tempDir)).toEqual([]);
    });
  });

  describe("mechaAuthSwitchBot", () => {
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

    it("updates bot config with auth profile", () => {
      const dir = setup();
      mechaAuthAdd(dir, "personal", "oauth", "tok-123");

      // Create bot dir with config
      const botDir = join(dir, "alice");
      mkdirSync(botDir, { recursive: true });
      writeFileSync(join(botDir, "config.json"), JSON.stringify({ port: 7700, token: "t", workspace: "/ws" }));

      const info: ProcessInfo = { name: "alice" as BotName, state: "running", workspacePath: "/ws", port: 7700 };
      const pm = createMockPM({ get: vi.fn().mockReturnValue(info) });

      const result = mechaAuthSwitchBot(dir, pm, "alice" as BotName, "personal");
      expect(result.name).toBe("personal");

      const cfg = JSON.parse(readFileSync(join(botDir, "config.json"), "utf-8"));
      expect(cfg.auth).toBe("personal");
    });

    it("throws AuthProfileNotFoundError for unknown profile", () => {
      const dir = setup();
      const pm = createMockPM();
      expect(() => mechaAuthSwitchBot(dir, pm, "alice" as BotName, "nope")).toThrow(AuthProfileNotFoundError);
    });

    it("throws BotNotFoundError for unknown bot", () => {
      const dir = setup();
      mechaAuthAdd(dir, "personal", "oauth", "tok-123");
      const pm = createMockPM();
      expect(() => mechaAuthSwitchBot(dir, pm, "unknown" as BotName, "personal")).toThrow(BotNotFoundError);
    });
  });

  describe("mechaAuthProbe", () => {
    it("returns invalid for empty token", async () => {
      const dir = setup();
      mechaAuthAdd(dir, "empty", "oauth", "tok");
      mechaAuthRenew(dir, "empty", "");
      const result = await mechaAuthProbe(dir, "empty");
      expect(result.valid).toBe(false);
      expect(result.error).toBe("missing credentials");
    });

    it("returns invalid when credential entry is missing", async () => {
      const dir = setup();
      mechaAuthAdd(dir, "orphan", "oauth", "tok");
      // Remove credential entry directly, leaving profile intact
      const credPath = join(dir, "auth", "credentials.json");
      const creds = JSON.parse(readFileSync(credPath, "utf-8"));
      delete creds.orphan;
      writeFileSync(credPath, JSON.stringify(creds));

      const result = await mechaAuthProbe(dir, "orphan");
      expect(result.valid).toBe(false);
      expect(result.error).toBe("missing credentials");
    });

    it("throws AuthProfileNotFoundError for unknown profile", async () => {
      const dir = setup();
      await expect(mechaAuthProbe(dir, "nope")).rejects.toThrow(AuthProfileNotFoundError);
    });

    it("probes API with oauth token", async () => {
      const dir = setup();
      mechaAuthAdd(dir, "valid", "oauth", "sk-ant-oat01-fake");

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [] }), { status: 200 }),
      );

      const result = await mechaAuthProbe(dir, "valid");
      expect(result.valid).toBe(true);
      expect(fetchSpy).toHaveBeenCalledWith(
        "https://api.anthropic.com/v1/models",
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: "Bearer sk-ant-oat01-fake" }),
          redirect: "error",
        }),
      );

      fetchSpy.mockRestore();
    });

    it("probes API with api-key", async () => {
      const dir = setup();
      mechaAuthAdd(dir, "api", "api-key", "sk-ant-api03-fake");

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [] }), { status: 200 }),
      );

      const result = await mechaAuthProbe(dir, "api");
      expect(result.valid).toBe(true);
      expect(fetchSpy).toHaveBeenCalledWith(
        "https://api.anthropic.com/v1/models",
        expect.objectContaining({
          headers: expect.objectContaining({ "x-api-key": "sk-ant-api03-fake" }),
          redirect: "error",
        }),
      );

      fetchSpy.mockRestore();
    });
  });
});
