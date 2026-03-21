import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  resolveAuth,
  readAuthProfiles,
  readAuthCredentials,
  authEnvVar,
  listAuthProfiles,
  getDefaultProfileName,
} from "../src/auth-resolve.js";
import { AuthProfileNotFoundError, AuthTokenInvalidError } from "../src/errors.js";
import type { AuthProfileStore, AuthCredentialStore } from "../src/auth-resolve.js";

describe("auth-resolve", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  function setup(opts?: {
    profiles?: AuthProfileStore;
    credentials?: AuthCredentialStore;
  }): string {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-auth-resolve-"));
    mkdirSync(join(tempDir, "auth"), { recursive: true });
    if (opts?.profiles) {
      writeFileSync(
        join(tempDir, "auth", "profiles.json"),
        JSON.stringify(opts.profiles),
      );
    }
    if (opts?.credentials) {
      writeFileSync(
        join(tempDir, "auth", "credentials.json"),
        JSON.stringify(opts.credentials),
      );
    }
    return tempDir;
  }

  describe("authEnvVar", () => {
    it("maps oauth to CLAUDE_CODE_OAUTH_TOKEN", () => {
      expect(authEnvVar("oauth")).toBe("CLAUDE_CODE_OAUTH_TOKEN");
    });

    it("maps api-key to ANTHROPIC_API_KEY", () => {
      expect(authEnvVar("api-key")).toBe("ANTHROPIC_API_KEY");
    });
  });

  describe("readAuthProfiles", () => {
    it("returns empty store when files missing", () => {
      const dir = setup();
      const store = readAuthProfiles(dir);
      expect(store.default).toBeNull();
      expect(store.profiles).toEqual({});
    });

    it("reads valid profiles.json", () => {
      const dir = setup({
        profiles: {
          default: "personal",
          profiles: {
            personal: {
              type: "oauth",
              account: "user@example.com",
              label: "Personal",
              tags: [],
              expiresAt: 2000000000000,
              createdAt: "2026-02-26T00:00:00Z",
            },
          },
        },
      });
      const store = readAuthProfiles(dir);
      expect(store.default).toBe("personal");
      expect(store.profiles.personal.type).toBe("oauth");
    });
  });

  describe("readAuthCredentials", () => {
    it("returns empty object when file missing", () => {
      const dir = setup();
      expect(readAuthCredentials(dir)).toEqual({});
    });

    it("reads valid credentials", () => {
      const dir = setup({ credentials: { personal: { token: "sk-abc" } } });
      expect(readAuthCredentials(dir).personal.token).toBe("sk-abc");
    });
  });

  describe("resolveAuth", () => {
    const profiles: AuthProfileStore = {
      default: "personal",
      profiles: {
        personal: {
          type: "oauth",
          account: "user@example.com",
          label: "Personal",
          tags: [],
          expiresAt: 2000000000000,
          createdAt: "2026-02-26T00:00:00Z",
        },
        team: {
          type: "api-key",
          account: null,
          label: "Team key",
          tags: ["team"],
          expiresAt: null,
          createdAt: "2026-02-26T00:00:00Z",
        },
      },
    };
    const credentials: AuthCredentialStore = {
      personal: { token: "sk-ant-oat01-aaa" },
      team: { token: "sk-ant-api03-xxx" },
    };

    it("resolves explicit profile name (oauth)", () => {
      const dir = setup({ profiles, credentials });
      const result = resolveAuth(dir, "personal");
      expect(result).toEqual({
        profileName: "personal",
        type: "oauth",
        envVar: "CLAUDE_CODE_OAUTH_TOKEN",
        token: "sk-ant-oat01-aaa",
      });
    });

    it("resolves explicit profile name (api-key)", () => {
      const dir = setup({ profiles, credentials });
      const result = resolveAuth(dir, "team");
      expect(result).toEqual({
        profileName: "team",
        type: "api-key",
        envVar: "ANTHROPIC_API_KEY",
        token: "sk-ant-api03-xxx",
      });
    });

    it("falls back to default profile when no name given", () => {
      const dir = setup({ profiles, credentials });
      const result = resolveAuth(dir);
      expect(result!.profileName).toBe("personal");
    });

    it("returns null for explicit --no-auth (null)", () => {
      const dir = setup({ profiles, credentials });
      expect(resolveAuth(dir, null)).toBeNull();
    });

    it("throws when explicit profile not found", () => {
      const dir = setup({ profiles, credentials });
      expect(() => resolveAuth(dir, "nonexistent")).toThrow(AuthProfileNotFoundError);
    });

    it("throws when no default set and no name given", () => {
      const dir = setup({
        profiles: { default: null, profiles: {} },
        credentials: {},
      });
      expect(() => resolveAuth(dir)).toThrow(AuthProfileNotFoundError);
      expect(() => resolveAuth(dir)).toThrow(/no default profile/);
    });

    it("throws when credentials missing for profile", () => {
      const dir = setup({
        profiles,
        credentials: {}, // no credentials
      });
      expect(() => resolveAuth(dir, "personal")).toThrow(AuthTokenInvalidError);
      expect(() => resolveAuth(dir, "personal")).toThrow(/invalid/);
    });

    describe("$env: sentinel profiles", () => {
      const origApiKey = process.env.ANTHROPIC_API_KEY;
      const origOauth = process.env.CLAUDE_CODE_OAUTH_TOKEN;

      afterEach(() => {
        if (origApiKey !== undefined) process.env.ANTHROPIC_API_KEY = origApiKey;
        else delete process.env.ANTHROPIC_API_KEY;
        if (origOauth !== undefined) process.env.CLAUDE_CODE_OAUTH_TOKEN = origOauth;
        else delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
      });

      it("resolves $env:api-key when ANTHROPIC_API_KEY is set", () => {
        process.env.ANTHROPIC_API_KEY = "sk-test-key-123";
        const dir = setup();
        const result = resolveAuth(dir, "$env:api-key");
        expect(result).toEqual({
          profileName: "$env:api-key",
          type: "api-key",
          envVar: "ANTHROPIC_API_KEY",
          token: "sk-test-key-123",
        });
      });

      it("resolves $env:oauth when CLAUDE_CODE_OAUTH_TOKEN is set", () => {
        process.env.CLAUDE_CODE_OAUTH_TOKEN = "oat-test-token";
        const dir = setup();
        const result = resolveAuth(dir, "$env:oauth");
        expect(result).toEqual({
          profileName: "$env:oauth",
          type: "oauth",
          envVar: "CLAUDE_CODE_OAUTH_TOKEN",
          token: "oat-test-token",
        });
      });

      it("throws AuthTokenInvalidError when env var not set", () => {
        delete process.env.ANTHROPIC_API_KEY;
        const dir = setup();
        expect(() => resolveAuth(dir, "$env:api-key")).toThrow(AuthTokenInvalidError);
        expect(() => resolveAuth(dir, "$env:api-key")).toThrow(/ANTHROPIC_API_KEY not set/);
      });

      it("throws AuthProfileNotFoundError for unknown $env: sentinel", () => {
        const dir = setup();
        expect(() => resolveAuth(dir, "$env:unknown")).toThrow(AuthProfileNotFoundError);
      });
    });
  });

  describe("listAuthProfiles", () => {
    it("returns empty array when no profiles", () => {
      const dir = setup();
      expect(listAuthProfiles(dir)).toEqual([]);
    });

    it("returns all profiles with name", () => {
      const dir = setup({
        profiles: {
          default: "a",
          profiles: {
            a: { type: "oauth", account: "a@b.com", label: "A", tags: [], expiresAt: null, createdAt: "2026-01-01T00:00:00Z" },
            b: { type: "api-key", account: null, label: "B", tags: ["dev"], expiresAt: null, createdAt: "2026-01-01T00:00:00Z" },
          },
        },
      });
      const result = listAuthProfiles(dir);
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("a");
      expect(result[1].name).toBe("b");
      expect(result[1].tags).toEqual(["dev"]);
    });
  });

  describe("getDefaultProfileName", () => {
    it("returns null when no profiles", () => {
      const dir = setup();
      expect(getDefaultProfileName(dir)).toBeNull();
    });

    it("returns default name", () => {
      const dir = setup({
        profiles: {
          default: "personal",
          profiles: {
            personal: { type: "oauth", account: null, label: "", tags: [], expiresAt: null, createdAt: "" },
          },
        },
      });
      expect(getDefaultProfileName(dir)).toBe("personal");
    });
  });
});
