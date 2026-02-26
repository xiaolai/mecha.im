import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

vi.mock("@mecha/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mecha/core")>();
  return {
    ...actual,
    loadNodeIdentity: vi.fn().mockReturnValue(null),
    loadNodePrivateKey: vi.fn().mockReturnValue(null),
    createCasaIdentity: vi.fn(),
    CASA_CONFIG_VERSION: 1,
  };
});

import { prepareCasaFilesystem, encodeProjectPath, type CasaFilesystemOpts } from "../src/sandbox-setup.js";

describe("sandbox-setup", () => {
  let tempDir: string;
  let casaDir: string;
  let mechaDir: string;

  function makeOpts(overrides?: Partial<CasaFilesystemOpts>): CasaFilesystemOpts {
    return {
      casaDir,
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
    casaDir = join(tempDir, "casa");
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
      expect(encodeProjectPath("/home/testuser/project")).toBe("-home-alice-project");
    });

    it("handles root path", () => {
      expect(encodeProjectPath("/")).toBe("-");
    });

    it("handles Windows paths with backslashes and drive letter", () => {
      expect(encodeProjectPath("C:\\Users\\joker\\project")).toBe("C--home-alice-project");
    });

    it("handles mixed separators", () => {
      expect(encodeProjectPath("C:\\Users/joker\\project")).toBe("C--home-alice-project");
    });
  });

  describe("prepareCasaFilesystem", () => {
    it("creates all required directories", () => {
      const result = prepareCasaFilesystem(makeOpts());
      expect(existsSync(result.homeDir)).toBe(true);
      expect(existsSync(result.tmpDir)).toBe(true);
      expect(existsSync(result.logsDir)).toBe(true);
      expect(existsSync(result.projectsDir)).toBe(true);
    });

    it("writes config.json with correct content", () => {
      prepareCasaFilesystem(makeOpts({ tags: ["code"], expose: ["query"] }));
      const config = JSON.parse(readFileSync(join(casaDir, "config.json"), "utf-8"));
      expect(config.configVersion).toBe(1);
      expect(config.port).toBe(7700);
      expect(config.token).toBe("test-token");
      expect(config.workspace).toBe("/home/testuser/project");
      expect(config.tags).toEqual(["code"]);
      expect(config.expose).toEqual(["query"]);
    });

    it("writes settings.json with hooks", () => {
      const result = prepareCasaFilesystem(makeOpts());
      const claudeDir = join(result.homeDir, ".claude");
      const settings = JSON.parse(readFileSync(join(claudeDir, "settings.json"), "utf-8"));
      expect(settings.hooks.PreToolUse).toHaveLength(2);
      expect(settings.hooks.PreToolUse[0].matcher).toBe("Read|Write|Edit|Glob|Grep");
      expect(settings.hooks.PreToolUse[1].matcher).toBe("Bash");
    });

    it("writes executable hook scripts", () => {
      const result = prepareCasaFilesystem(makeOpts());
      const hooksDir = join(result.homeDir, ".claude", "hooks");
      expect(existsSync(join(hooksDir, "sandbox-guard.sh"))).toBe(true);
      expect(existsSync(join(hooksDir, "bash-guard.sh"))).toBe(true);
    });

    it("bash guard does not rewrite commands (no echo/stdout)", () => {
      const result = prepareCasaFilesystem(makeOpts());
      const bashGuard = readFileSync(join(result.homeDir, ".claude", "hooks", "bash-guard.sh"), "utf-8");
      expect(bashGuard).not.toContain('echo "cd');
      expect(bashGuard).toContain("exit 0");
      expect(bashGuard).not.toContain("cd \\");
    });

    it("sets reserved env vars that cannot be overridden by userEnv", () => {
      const result = prepareCasaFilesystem(makeOpts({
        userEnv: { MECHA_CASA_NAME: "evil", CUSTOM_VAR: "hello" },
      }));
      expect(result.childEnv.MECHA_CASA_NAME).toBe("alice");
      expect(result.childEnv.CUSTOM_VAR).toBe("hello");
    });

    it("strips all reserved keys from userEnv", () => {
      const result = prepareCasaFilesystem(makeOpts({
        userEnv: {
          MECHA_PORT: "9999",
          HOME: "/evil",
          TMPDIR: "/evil",
          MECHA_DIR: "/evil",
          SAFE_KEY: "ok",
        },
      }));
      expect(result.childEnv.MECHA_PORT).toBe("7700");
      expect(result.childEnv.HOME).toBe(join(casaDir, "home"));
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
      const result = prepareCasaFilesystem(makeOpts({ userEnv: dangerousVars }));

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
      const result = prepareCasaFilesystem(makeOpts({
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
        const result = prepareCasaFilesystem(makeOpts({ auth: "personal" }));
        expect(result.childEnv.CLAUDE_CODE_OAUTH_TOKEN).toBe("sk-ant-oat01-aaa");
        expect(result.childEnv.ANTHROPIC_API_KEY).toBeUndefined();
      });

      it("resolves API key profile to ANTHROPIC_API_KEY", () => {
        setupAuthProfiles({ team: { type: "api-key", token: "sk-ant-api03-xxx" } });
        const result = prepareCasaFilesystem(makeOpts({ auth: "team" }));
        expect(result.childEnv.ANTHROPIC_API_KEY).toBe("sk-ant-api03-xxx");
        expect(result.childEnv.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
      });

      it("uses default profile when --auth not specified", () => {
        setupAuthProfiles({ personal: { type: "oauth", token: "default-tok" } });
        const result = prepareCasaFilesystem(makeOpts());
        expect(result.childEnv.CLAUDE_CODE_OAUTH_TOKEN).toBe("default-tok");
      });

      it("falls back to host env when no profiles exist", () => {
        // No auth profiles set up, but host env has a key
        process.env.ANTHROPIC_API_KEY = "sk-ant-host-key";
        const result = prepareCasaFilesystem(makeOpts());
        expect(result.childEnv.ANTHROPIC_API_KEY).toBe("sk-ant-host-key");
      });

      it("sets no SDK keys when --no-auth (null) and no host env", () => {
        delete process.env.ANTHROPIC_API_KEY;
        delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
        const result = prepareCasaFilesystem(makeOpts({ auth: null }));
        expect(result.childEnv.ANTHROPIC_API_KEY).toBeUndefined();
        expect(result.childEnv.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
      });
    });
  });
});
