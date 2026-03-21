import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildBotEnv, type BuildBotEnvOpts } from "../src/build-bot-env.js";

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "build-bot-env-test-"));
}

function baseOpts(mechaDir: string, overrides?: Partial<BuildBotEnvOpts>): BuildBotEnvOpts {
  const tmp = makeTmpDir();
  return {
    botDir: tmp,
    homeDir: tmp,
    tmpDir: tmp,
    logsDir: tmp,
    projectsDir: tmp,
    workspacePath: "/workspace",
    port: 7700,
    token: "test-token",
    name: "test-bot",
    mechaDir,
    meterOff: true,
    ...overrides,
  };
}

describe("buildBotEnv", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    savedEnv.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    savedEnv.CLAUDE_CODE_OAUTH_TOKEN = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  });

  afterEach(() => {
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = val;
      }
    }
  });

  it("throws descriptive error when no API credentials available", () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;

    // Use a mechaDir with no auth profiles directory
    const mechaDir = makeTmpDir();

    expect(() => buildBotEnv(baseOpts(mechaDir))).toThrow(
      /No API credentials available for bot "test-bot"/,
    );
  });

  it("includes setup instructions in the error message", () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;

    const mechaDir = makeTmpDir();

    expect(() => buildBotEnv(baseOpts(mechaDir))).toThrow(
      /mecha auth add/,
    );
  });

  it("succeeds when ANTHROPIC_API_KEY is in host environment", () => {
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-key";

    const mechaDir = makeTmpDir();
    const env = buildBotEnv(baseOpts(mechaDir));

    expect(env.ANTHROPIC_API_KEY).toBe("sk-ant-test-key");
  });

  it("succeeds when CLAUDE_CODE_OAUTH_TOKEN is in host environment", () => {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.CLAUDE_CODE_OAUTH_TOKEN = "oauth-test-token";

    const mechaDir = makeTmpDir();
    const env = buildBotEnv(baseOpts(mechaDir));

    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe("oauth-test-token");
  });

  it("succeeds when auth profile provides credentials", () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;

    // Set up a valid auth profile directory structure
    const mechaDir = makeTmpDir();
    const authDir = join(mechaDir, "auth");
    mkdirSync(authDir, { recursive: true });

    writeFileSync(
      join(authDir, "profiles.json"),
      JSON.stringify({
        default: "test-profile",
        profiles: {
          "test-profile": {
            type: "api-key",
            account: null,
            label: "Test",
            tags: [],
            expiresAt: null,
            createdAt: new Date().toISOString(),
          },
        },
      }),
    );

    writeFileSync(
      join(authDir, "credentials.json"),
      JSON.stringify({
        "test-profile": { token: "sk-ant-profile-key" },
      }),
    );

    const env = buildBotEnv(baseOpts(mechaDir));
    expect(env.ANTHROPIC_API_KEY).toBe("sk-ant-profile-key");
  });
});
