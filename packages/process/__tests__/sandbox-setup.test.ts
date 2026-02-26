import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

vi.mock("@mecha/core", () => ({
  loadNodeIdentity: vi.fn().mockReturnValue(null),
  loadNodePrivateKey: vi.fn().mockReturnValue(null),
  createCasaIdentity: vi.fn(),
  CASA_CONFIG_VERSION: 1,
}));

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

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-sandbox-test-"));
    casaDir = join(tempDir, "casa");
    mechaDir = join(tempDir, "mecha");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    // Clean up env vars that tests may set
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
      // Should NOT contain echo that rewrites commands
      expect(bashGuard).not.toContain('echo "cd');
      // Should contain exit 0 for allowing commands as-is
      expect(bashGuard).toContain("exit 0");
      // Should NOT prefix with cd
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
        LD_PRELOAD: "/evil/lib.so",
        LD_LIBRARY_PATH: "/evil/lib",
        DYLD_INSERT_LIBRARIES: "/evil/lib.dylib",
        DYLD_LIBRARY_PATH: "/evil/lib",
        SAFE_KEY: "allowed",
      };
      const result = prepareCasaFilesystem(makeOpts({ userEnv: dangerousVars }));

      // All dangerous vars should be stripped
      expect(result.childEnv.NODE_OPTIONS).toBeUndefined();
      expect(result.childEnv.NODE_PATH).toBeUndefined();
      expect(result.childEnv.NODE_DEBUG).toBeUndefined();
      expect(result.childEnv.NODE_EXTRA_CA_CERTS).toBeUndefined();
      expect(result.childEnv.NODE_REDIRECT_WARNINGS).toBeUndefined();
      expect(result.childEnv.LD_PRELOAD).toBeUndefined();
      expect(result.childEnv.LD_LIBRARY_PATH).toBeUndefined();
      expect(result.childEnv.DYLD_INSERT_LIBRARIES).toBeUndefined();
      expect(result.childEnv.DYLD_LIBRARY_PATH).toBeUndefined();

      // Safe key should pass through
      expect(result.childEnv.SAFE_KEY).toBe("allowed");
    });

    describe("SDK auth key forwarding", () => {
      it("forwards ANTHROPIC_API_KEY from parent env", () => {
        process.env.ANTHROPIC_API_KEY = "sk-ant-test-key";
        const result = prepareCasaFilesystem(makeOpts());
        expect(result.childEnv.ANTHROPIC_API_KEY).toBe("sk-ant-test-key");
      });

      it("forwards CLAUDE_CODE_OAUTH_TOKEN from parent env", () => {
        process.env.CLAUDE_CODE_OAUTH_TOKEN = "oauth-test-token";
        const result = prepareCasaFilesystem(makeOpts());
        expect(result.childEnv.CLAUDE_CODE_OAUTH_TOKEN).toBe("oauth-test-token");
      });

      it("allows userEnv to override SDK keys", () => {
        process.env.ANTHROPIC_API_KEY = "parent-key";
        const result = prepareCasaFilesystem(makeOpts({
          userEnv: { ANTHROPIC_API_KEY: "user-key" },
        }));
        expect(result.childEnv.ANTHROPIC_API_KEY).toBe("user-key");
      });

      it("does not set SDK keys when absent from parent env", () => {
        delete process.env.ANTHROPIC_API_KEY;
        delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
        const result = prepareCasaFilesystem(makeOpts());
        expect(result.childEnv.ANTHROPIC_API_KEY).toBeUndefined();
        expect(result.childEnv.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
      });
    });
  });
});
