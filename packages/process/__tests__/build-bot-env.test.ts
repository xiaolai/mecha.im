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
    // Save and clear CLAUDE_SETUP_TOKEN_* vars (OAuth session tokens)
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("CLAUDE_SETUP_TOKEN_")) {
        savedEnv[key] = process.env[key];
      }
    }
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

  it("warns (does not throw) when no API credentials available", () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    // Clear all CLAUDE_SETUP_TOKEN_* vars so fallback doesn't find one
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("CLAUDE_SETUP_TOKEN_")) delete process.env[key];
    }

    // Use a mechaDir with no auth profiles directory
    const mechaDir = makeTmpDir();

    // No throw — Claude CLI uses its own OAuth session
    const env = buildBotEnv(baseOpts(mechaDir));
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
  });

  it("does not inherit host ANTHROPIC_API_KEY (blocked by reservedKeys)", () => {
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-key";

    // ANTHROPIC_API_KEY is blocked from host env to prevent API key overriding
    // the user's Claude Pro/Max OAuth session. Auth must come from profiles.
    const mechaDir = makeTmpDir();
    const env = buildBotEnv(baseOpts(mechaDir));

    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
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
