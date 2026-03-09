import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { prepareBotFilesystem, encodeProjectPath, type BotFilesystemOpts } from "../src/sandbox-setup.js";

describe("sandbox-setup", () => {
  let tempDir: string;
  let botDir: string;
  let mechaDir: string;

  function makeOpts(overrides?: Partial<BotFilesystemOpts>): BotFilesystemOpts {
    return {
      botDir,
      workspacePath: "/home/testuser/project",
      port: 7700,
      token: "test-token",
      name: "alice",
      mechaDir,
      ...overrides,
    };
  }

  /** Set up mechaDir with auth profile store (split format). */
  function setupAuthProfiles(profiles: Record<string, { type: "oauth" | "api-key"; token: string }>): void {
    const authDir = join(mechaDir, "auth");
    mkdirSync(authDir, { recursive: true });

    const profileStore: Record<string, unknown> = {};
    const credStore: Record<string, { token: string }> = {};
    let defaultName: string | null = null;

    for (const [name, { type, token }] of Object.entries(profiles)) {
      if (!defaultName) defaultName = name;
      profileStore[name] = {
        type,
        account: null,
        label: "",
        tags: [],
        expiresAt: null,
        createdAt: "2026-02-26T00:00:00Z",
      };
      credStore[name] = { token };
    }

    writeFileSync(
      join(authDir, "profiles.json"),
      JSON.stringify({ default: defaultName, profiles: profileStore }),
    );
    writeFileSync(
      join(authDir, "credentials.json"),
      JSON.stringify(credStore),
    );
  }

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-sandbox-test-"));
    botDir = join(tempDir, "bot");
    mechaDir = join(tempDir, "mecha");
    mkdirSync(mechaDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
  });

  describe("encodeProjectPath", () => {
    it("replaces slashes with dashes", () => {
      expect(encodeProjectPath("/home/testuser/project")).toBe("-home-testuser-project");
    });

    it("handles root path", () => {
      expect(encodeProjectPath("/")).toBe("-");
    });

    it("handles Windows paths with backslashes and drive letter", () => {
      expect(encodeProjectPath("C:\\Users\\testuser\\project")).toBe("C--Users-testuser-project");
    });

    it("handles mixed separators", () => {
      expect(encodeProjectPath("C:\\Users/testuser\\project")).toBe("C--Users-testuser-project");
    });

    it("replaces dots with dashes", () => {
      expect(encodeProjectPath("/home/testuser/ori.gami.art")).toBe("-home-testuser-ori-gami-art");
    });
  });

  describe("prepareBotFilesystem", () => {
    it("creates all required directories", () => {
      const result = prepareBotFilesystem(makeOpts());
      expect(existsSync(result.homeDir)).toBe(true);
      expect(existsSync(result.tmpDir)).toBe(true);
      expect(existsSync(result.logsDir)).toBe(true);
      expect(existsSync(result.projectsDir)).toBe(true);
      // Old home/ nesting must not exist
      expect(existsSync(join(botDir, "home"))).toBe(false);
    });

    it("writes config.json with correct content", () => {
      prepareBotFilesystem(makeOpts({ tags: ["code"], expose: ["query"] }));
      const config = JSON.parse(readFileSync(join(botDir, "config.json"), "utf-8"));
      expect(config.configVersion).toBe(1);
      expect(config.port).toBe(7700);
      expect(config.token).toBe("test-token");
      expect(config.workspace).toBe("/home/testuser/project");
      expect(config.tags).toEqual(["code"]);
      expect(config.expose).toEqual(["query"]);
    });

    it("writes settings.json with hooks", () => {
      const result = prepareBotFilesystem(makeOpts());
      const claudeDir = join(result.homeDir, ".claude");
      const settings = JSON.parse(readFileSync(join(claudeDir, "settings.json"), "utf-8"));
      expect(settings.hooks.PreToolUse).toHaveLength(2);
      expect(settings.hooks.PreToolUse[0].matcher).toBe("Read|Write|Edit|Glob|Grep");
      expect(settings.hooks.PreToolUse[1].matcher).toBe("Bash");
    });

    it("writes executable hook scripts", () => {
      const result = prepareBotFilesystem(makeOpts());
      const hooksDir = join(result.homeDir, ".claude", "hooks");
      expect(existsSync(join(hooksDir, "sandbox-guard.sh"))).toBe(true);
      expect(existsSync(join(hooksDir, "bash-guard.sh"))).toBe(true);
    });

    it("bash guard does not rewrite commands (no echo/stdout)", () => {
      const result = prepareBotFilesystem(makeOpts());
      const bashGuard = readFileSync(join(result.homeDir, ".claude", "hooks", "bash-guard.sh"), "utf-8");
      expect(bashGuard).not.toContain('echo "cd');
      expect(bashGuard).toContain("exit 0");
      expect(bashGuard).not.toContain("cd \\");
    });

    it("sets reserved env vars that cannot be overridden by userEnv", () => {
      const result = prepareBotFilesystem(makeOpts({
        userEnv: { MECHA_BOT_NAME: "evil", CUSTOM_VAR: "hello" },
      }));
      expect(result.childEnv.MECHA_BOT_NAME).toBe("alice");
      expect(result.childEnv.CUSTOM_VAR).toBe("hello");
    });

    it("strips all reserved keys from userEnv", () => {
      const result = prepareBotFilesystem(makeOpts({
        userEnv: {
          MECHA_PORT: "9999",
          HOME: "/evil",
          TMPDIR: "/evil",
          MECHA_DIR: "/evil",
          SAFE_KEY: "ok",
        },
      }));
      expect(result.childEnv.MECHA_PORT).toBe("7700");
      expect(result.childEnv.HOME).toBe(botDir);
      expect(result.childEnv.SAFE_KEY).toBe("ok");
    });

    it("blocks dangerous Node.js and linker env vars from userEnv", () => {
      const dangerousVars: Record<string, string> = {
        NODE_OPTIONS: "--require /evil/payload.js",
        NODE_PATH: "/evil/modules",
        NODE_DEBUG: "http",
        NODE_EXTRA_CA_CERTS: "/evil/ca.pem",
        NODE_REDIRECT_WARNINGS: "/evil/warnings.log",
        NODE_V8_COVERAGE: "/evil/coverage",
        NODE_PROF: "1",
        LD_PRELOAD: "/evil/lib.so",
        LD_LIBRARY_PATH: "/evil/lib",
        DYLD_INSERT_LIBRARIES: "/evil/lib.dylib",
        DYLD_LIBRARY_PATH: "/evil/lib",
        SAFE_KEY: "allowed",
      };
      const result = prepareBotFilesystem(makeOpts({ userEnv: dangerousVars }));

      expect(result.childEnv.NODE_OPTIONS).toBeUndefined();
      expect(result.childEnv.NODE_PATH).toBeUndefined();
      expect(result.childEnv.NODE_DEBUG).toBeUndefined();
      expect(result.childEnv.NODE_EXTRA_CA_CERTS).toBeUndefined();
      expect(result.childEnv.NODE_REDIRECT_WARNINGS).toBeUndefined();
      expect(result.childEnv.NODE_V8_COVERAGE).toBeUndefined();
      expect(result.childEnv.NODE_PROF).toBeUndefined();
      expect(result.childEnv.LD_PRELOAD).toBeUndefined();
      expect(result.childEnv.LD_LIBRARY_PATH).toBeUndefined();
      expect(result.childEnv.DYLD_INSERT_LIBRARIES).toBeUndefined();
      expect(result.childEnv.DYLD_LIBRARY_PATH).toBeUndefined();
      expect(result.childEnv.SAFE_KEY).toBe("allowed");
    });

    it("blocks BASH_FUNC_* export function env vars from userEnv", () => {
      const result = prepareBotFilesystem(makeOpts({
        userEnv: {
          "BASH_FUNC_evil%%": "() { /bin/evil; }",
          "BASH_FUNC_another%%": "() { echo pwned; }",
          SAFE_KEY: "ok",
        },
      }));
      expect(result.childEnv["BASH_FUNC_evil%%"]).toBeUndefined();
      expect(result.childEnv["BASH_FUNC_another%%"]).toBeUndefined();
      expect(result.childEnv.SAFE_KEY).toBe("ok");
    });

    describe("auth profile resolution", () => {
      it("resolves OAuth profile to CLAUDE_CODE_OAUTH_TOKEN", () => {
        setupAuthProfiles({ personal: { type: "oauth", token: "sk-ant-oat01-aaa" } });
        const result = prepareBotFilesystem(makeOpts({ auth: "personal" }));
        expect(result.childEnv.CLAUDE_CODE_OAUTH_TOKEN).toBe("sk-ant-oat01-aaa");
        expect(result.childEnv.ANTHROPIC_API_KEY).toBeUndefined();
      });

      it("resolves API key profile to ANTHROPIC_API_KEY", () => {
        setupAuthProfiles({ team: { type: "api-key", token: "sk-ant-api03-xxx" } });
        const result = prepareBotFilesystem(makeOpts({ auth: "team" }));
        expect(result.childEnv.ANTHROPIC_API_KEY).toBe("sk-ant-api03-xxx");
        expect(result.childEnv.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
      });

      it("uses default profile when --auth not specified", () => {
        setupAuthProfiles({ personal: { type: "oauth", token: "default-tok" } });
        const result = prepareBotFilesystem(makeOpts());
        expect(result.childEnv.CLAUDE_CODE_OAUTH_TOKEN).toBe("default-tok");
      });

      it("falls back to host env when no profiles exist", () => {
        // No auth profiles set up, but host env has a key
        process.env.ANTHROPIC_API_KEY = "sk-ant-host-key";
        const result = prepareBotFilesystem(makeOpts());
        expect(result.childEnv.ANTHROPIC_API_KEY).toBe("sk-ant-host-key");
      });

      it("sets no SDK keys when --no-auth (null) and no host env", () => {
        delete process.env.ANTHROPIC_API_KEY;
        delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
        const result = prepareBotFilesystem(makeOpts({ auth: null }));
        expect(result.childEnv.ANTHROPIC_API_KEY).toBeUndefined();
        expect(result.childEnv.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
      });
    });

    describe("credential seeding", () => {
      it("seeds .claude.json onboarding state", () => {
        const result = prepareBotFilesystem(makeOpts());
        const claudeJson = JSON.parse(readFileSync(join(result.homeDir, ".claude.json"), "utf-8"));
        expect(claudeJson.hasCompletedOnboarding).toBe(true);
        expect(claudeJson.numStartups).toBe(1);
      });

      it("does not overwrite existing .claude.json onboarding state", () => {
        // First prepare creates onboarding state
        prepareBotFilesystem(makeOpts());
        // Manually modify it
        const claudeJsonPath = join(botDir, ".claude.json");
        const modified = { numStartups: 42, hasCompletedOnboarding: true };
        writeFileSync(claudeJsonPath, JSON.stringify(modified));
        // Second prepare should preserve the modified file
        prepareBotFilesystem(makeOpts());
        const claudeJson = JSON.parse(readFileSync(claudeJsonPath, "utf-8"));
        expect(claudeJson.numStartups).toBe(42);
      });

      it("writes .credentials.json for oauth auth type", () => {
        setupAuthProfiles({ personal: { type: "oauth", token: "sk-ant-oat01-aaa" } });
        const result = prepareBotFilesystem(makeOpts({ auth: "personal" }));
        const credPath = join(result.homeDir, ".claude", ".credentials.json");
        expect(existsSync(credPath)).toBe(true);
        const creds = JSON.parse(readFileSync(credPath, "utf-8"));
        expect(creds.claudeAiOauth.accessToken).toBe("sk-ant-oat01-aaa");
      });

      it("overwrites stale .credentials.json when auth profile changes", () => {
        setupAuthProfiles({
          old: { type: "oauth", token: "old-token" },
          updated: { type: "oauth", token: "new-token" },
        });
        // First spawn with old profile
        prepareBotFilesystem(makeOpts({ auth: "old" }));
        const credPath = join(botDir, ".claude", ".credentials.json");
        const first = JSON.parse(readFileSync(credPath, "utf-8"));
        expect(first.claudeAiOauth.accessToken).toBe("old-token");

        // Second spawn with updated profile — must overwrite
        prepareBotFilesystem(makeOpts({ auth: "updated" }));
        const second = JSON.parse(readFileSync(credPath, "utf-8"));
        expect(second.claudeAiOauth.accessToken).toBe("new-token");
      });

      it("does not write .credentials.json for api-key auth type", () => {
        setupAuthProfiles({ team: { type: "api-key", token: "sk-ant-api03-xxx" } });
        const result = prepareBotFilesystem(makeOpts({ auth: "team" }));
        const credPath = join(result.homeDir, ".claude", ".credentials.json");
        expect(existsSync(credPath)).toBe(false);
        // But onboarding state should still be seeded
        const claudeJson = JSON.parse(readFileSync(join(result.homeDir, ".claude.json"), "utf-8"));
        expect(claudeJson.hasCompletedOnboarding).toBe(true);
      });

      it("removes stale .credentials.json when switching from oauth to api-key", () => {
        setupAuthProfiles({
          oauth_profile: { type: "oauth", token: "sk-ant-oat01-aaa" },
          apikey_profile: { type: "api-key", token: "sk-ant-api03-xxx" },
        });
        // First spawn with OAuth — writes .credentials.json
        const result = prepareBotFilesystem(makeOpts({ auth: "oauth_profile" }));
        const credPath = join(result.homeDir, ".claude", ".credentials.json");
        expect(existsSync(credPath)).toBe(true);

        // Second spawn with API key — must remove stale OAuth credentials
        prepareBotFilesystem(makeOpts({ auth: "apikey_profile" }));
        expect(existsSync(credPath)).toBe(false);
      });

      it("seeds onboarding state even when auth resolution fails", () => {
        // No auth profiles, no host env — auth resolution fails
        delete process.env.ANTHROPIC_API_KEY;
        delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
        const result = prepareBotFilesystem(makeOpts());
        const claudeJson = JSON.parse(readFileSync(join(result.homeDir, ".claude.json"), "utf-8"));
        expect(claudeJson.hasCompletedOnboarding).toBe(true);
      });
    });

    describe("meter proxy integration", () => {
      function writeMeterProxy(opts: { port: number; pid: number; required: boolean }): void {
        const md = join(mechaDir, "meter");
        mkdirSync(md, { recursive: true });
        writeFileSync(join(md, "proxy.json"), JSON.stringify({
          port: opts.port,
          pid: opts.pid,
          required: opts.required,
          startedAt: new Date().toISOString(),
        }));
      }

      it("sets ANTHROPIC_BASE_URL when proxy alive", () => {
        writeMeterProxy({ port: 7600, pid: process.pid, required: false });
        const result = prepareBotFilesystem(makeOpts());
        expect(result.childEnv.ANTHROPIC_BASE_URL).toBe(`http://127.0.0.1:7600/bot/alice`);
      });

      it("skips metering when --meter off", () => {
        writeMeterProxy({ port: 7600, pid: process.pid, required: false });
        const result = prepareBotFilesystem(makeOpts({ meterOff: true }));
        expect(result.childEnv.ANTHROPIC_BASE_URL).toBeUndefined();
      });

      it("skips metering when no proxy.json exists", () => {
        const result = prepareBotFilesystem(makeOpts());
        expect(result.childEnv.ANTHROPIC_BASE_URL).toBeUndefined();
      });

      it("throws MeterProxyRequiredError when proxy dead and required", () => {
        writeMeterProxy({ port: 7600, pid: 999999, required: true });
        expect(() => prepareBotFilesystem(makeOpts())).toThrow("Metering proxy required but not running");
      });

      it("logs warning when proxy dead and not required", () => {
        writeMeterProxy({ port: 7600, pid: 999999, required: false });
        const spy = vi.spyOn(console, "error").mockImplementation(() => {});
        const result = prepareBotFilesystem(makeOpts());
        expect(result.childEnv.ANTHROPIC_BASE_URL).toBeUndefined();
        expect(spy).toHaveBeenCalledWith(expect.stringContaining("stale proxy.json"));
        spy.mockRestore();
      });
    });
  });
});
