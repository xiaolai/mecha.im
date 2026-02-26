import { describe, it, expect, afterEach } from "vitest";
import { resolveEnvVars, resolveEnvString } from "../src/plugin-resolve.js";
import { PluginEnvError } from "../src/plugin-registry.js";

describe("plugin-resolve", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("resolveEnvString", () => {
    it("returns plain string unchanged", () => {
      expect(resolveEnvString("hello")).toBe("hello");
    });

    it("resolves ${VAR} from process.env", () => {
      process.env.MY_TOKEN = "secret123";
      expect(resolveEnvString("Bearer ${MY_TOKEN}")).toBe("Bearer secret123");
    });

    it("resolves multiple variables in one string", () => {
      process.env.HOST = "localhost";
      process.env.PORT = "8080";
      expect(resolveEnvString("http://${HOST}:${PORT}/mcp")).toBe("http://localhost:8080/mcp");
    });

    it("uses fallback with ${VAR:-default} when var missing", () => {
      delete process.env.MISSING;
      expect(resolveEnvString("${MISSING:-fallback}")).toBe("fallback");
    });

    it("uses env value over fallback", () => {
      process.env.PRESENT = "real";
      expect(resolveEnvString("${PRESENT:-fallback}")).toBe("real");
    });

    it("supports empty fallback ${VAR:-}", () => {
      delete process.env.MISSING;
      expect(resolveEnvString("prefix${MISSING:-}suffix")).toBe("prefixsuffix");
    });

    it("throws PluginEnvError for unresolved var without fallback", () => {
      delete process.env.MISSING;
      expect(() => resolveEnvString("${MISSING}")).toThrow(PluginEnvError);
      expect(() => resolveEnvString("${MISSING}")).toThrow(/MISSING/);
    });
  });

  describe("resolveEnvVars", () => {
    it("resolves all values in a record", () => {
      process.env.GH_TOKEN = "tok123";
      const result = resolveEnvVars({
        GITHUB_TOKEN: "${GH_TOKEN}",
        PLAIN: "literal",
      });
      expect(result).toEqual({
        GITHUB_TOKEN: "tok123",
        PLAIN: "literal",
      });
    });

    it("returns empty record for empty input", () => {
      expect(resolveEnvVars({})).toEqual({});
    });

    it("throws on first unresolved variable", () => {
      delete process.env.MISSING;
      expect(() => resolveEnvVars({ KEY: "${MISSING}" })).toThrow(PluginEnvError);
    });
  });
});
