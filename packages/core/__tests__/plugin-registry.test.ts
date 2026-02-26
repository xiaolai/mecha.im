import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  pluginName,
  readPluginRegistry,
  writePluginRegistry,
  addPlugin,
  removePlugin,
  getPlugin,
  listPlugins,
  isPluginName,
  PluginNameReservedError,
  PluginNotFoundError,
  PluginAlreadyExistsError,
  RESERVED_PLUGIN_NAMES,
  type PluginName,
  type StdioPluginConfig,
  type HttpPluginConfig,
} from "../src/plugin-registry.js";
import { InvalidNameError } from "../src/errors.js";

describe("plugin-registry", () => {
  let mechaDir: string;

  beforeEach(() => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-plugin-"));
  });
  afterEach(() => {
    rmSync(mechaDir, { recursive: true, force: true });
  });

  describe("pluginName", () => {
    it("accepts valid lowercase names", () => {
      expect(pluginName("chrome-bridge")).toBe("chrome-bridge");
      expect(pluginName("fs")).toBe("fs");
      expect(pluginName("my-plugin-123")).toBe("my-plugin-123");
    });

    it("rejects invalid names", () => {
      expect(() => pluginName("")).toThrow(InvalidNameError);
      expect(() => pluginName("UPPER")).toThrow(InvalidNameError);
      expect(() => pluginName("-leading")).toThrow(InvalidNameError);
      expect(() => pluginName("trailing-")).toThrow(InvalidNameError);
      expect(() => pluginName("has spaces")).toThrow(InvalidNameError);
      expect(() => pluginName("a".repeat(33))).toThrow(InvalidNameError);
    });

    it("rejects reserved names", () => {
      expect(() => pluginName("query")).toThrow(PluginNameReservedError);
      expect(() => pluginName("read-workspace")).not.toThrow(); // read_workspace has underscore, this is different
      expect(() => pluginName("mecha")).toThrow(PluginNameReservedError);
      expect(() => pluginName("mecha-workspace")).toThrow(PluginNameReservedError);
      expect(() => pluginName("lifecycle")).toThrow(PluginNameReservedError);
    });

    it("rejects dangerous object prototype keys", () => {
      // __proto__ has underscores — fails name validation first
      expect(() => pluginName("__proto__")).toThrow(InvalidNameError);
      // constructor passes name validation but is reserved
      expect(() => pluginName("constructor")).toThrow(PluginNameReservedError);
      // tostring is NOT reserved (case-sensitive, "toString" has uppercase)
      expect(() => pluginName("tostring")).not.toThrow();
    });

    it("RESERVED_PLUGIN_NAMES includes all capabilities plus internal names", () => {
      expect(RESERVED_PLUGIN_NAMES).toContain("query");
      expect(RESERVED_PLUGIN_NAMES).toContain("read_workspace");
      expect(RESERVED_PLUGIN_NAMES).toContain("mecha");
      expect(RESERVED_PLUGIN_NAMES).toContain("mecha-workspace");
      expect(RESERVED_PLUGIN_NAMES.length).toBeGreaterThanOrEqual(8);
    });
  });

  describe("readPluginRegistry", () => {
    it("returns empty registry when file missing", () => {
      const reg = readPluginRegistry(mechaDir);
      expect(reg.version).toBe(1);
      expect(Object.keys(reg.plugins)).toHaveLength(0);
    });

    it("reads valid registry from disk", () => {
      const data = {
        version: 1,
        plugins: {
          "test-plugin": {
            type: "http",
            url: "http://localhost:8080/mcp",
            addedAt: "2026-01-01T00:00:00Z",
          },
        },
      };
      writeFileSync(join(mechaDir, "plugins.json"), JSON.stringify(data));

      const reg = readPluginRegistry(mechaDir);
      expect(Object.keys(reg.plugins)).toHaveLength(1);
      expect(reg.plugins["test-plugin"].type).toBe("http");
    });

    it("throws on corrupt JSON", () => {
      writeFileSync(join(mechaDir, "plugins.json"), "not json");
      expect(() => readPluginRegistry(mechaDir)).toThrow(/corrupt/i);
    });

    it("throws on invalid schema", () => {
      writeFileSync(join(mechaDir, "plugins.json"), JSON.stringify({ version: 99, plugins: {} }));
      expect(() => readPluginRegistry(mechaDir)).toThrow();
    });
  });

  describe("writePluginRegistry", () => {
    it("writes registry to disk atomically", () => {
      const reg = {
        version: 1 as const,
        plugins: {
          "test": {
            type: "stdio" as const,
            command: "npx",
            addedAt: "2026-01-01T00:00:00Z",
          },
        },
      };
      writePluginRegistry(mechaDir, reg);
      const read = readPluginRegistry(mechaDir);
      expect(read.plugins["test"].type).toBe("stdio");
    });
  });

  describe("addPlugin", () => {
    const now = "2026-01-01T00:00:00Z";
    const httpConfig: HttpPluginConfig = {
      type: "http",
      url: "http://localhost:8080/mcp",
      addedAt: now,
    };
    const stdioConfig: StdioPluginConfig = {
      type: "stdio",
      command: "npx",
      args: ["-y", "mcp-fs"],
      addedAt: now,
    };

    it("adds a new plugin", () => {
      addPlugin(mechaDir, pluginName("test"), httpConfig);
      const plugin = getPlugin(mechaDir, "test");
      expect(plugin).toBeDefined();
      expect(plugin!.type).toBe("http");
    });

    it("throws on duplicate without force", () => {
      addPlugin(mechaDir, pluginName("test"), httpConfig);
      expect(() => addPlugin(mechaDir, pluginName("test"), stdioConfig)).toThrow(PluginAlreadyExistsError);
    });

    it("overwrites with force", () => {
      addPlugin(mechaDir, pluginName("test"), httpConfig);
      addPlugin(mechaDir, pluginName("test"), stdioConfig, true);
      const plugin = getPlugin(mechaDir, "test");
      expect(plugin!.type).toBe("stdio");
    });

    it("can store env and headers", () => {
      const withEnv: StdioPluginConfig = {
        ...stdioConfig,
        env: { GITHUB_TOKEN: "${GITHUB_TOKEN}" },
      };
      addPlugin(mechaDir, pluginName("gh"), withEnv);
      const plugin = getPlugin(mechaDir, "gh");
      if (plugin?.type === "stdio") {
        expect(plugin.env).toEqual({ GITHUB_TOKEN: "${GITHUB_TOKEN}" });
      }
    });
  });

  describe("removePlugin", () => {
    it("removes existing plugin", () => {
      addPlugin(mechaDir, pluginName("test"), {
        type: "http",
        url: "http://localhost/mcp",
        addedAt: "2026-01-01T00:00:00Z",
      });
      expect(removePlugin(mechaDir, "test")).toBe(true);
      expect(getPlugin(mechaDir, "test")).toBeUndefined();
    });

    it("returns false for non-existent plugin", () => {
      expect(removePlugin(mechaDir, "ghost")).toBe(false);
    });

    it("throws on invalid name", () => {
      expect(() => removePlugin(mechaDir, "INVALID")).toThrow(InvalidNameError);
    });
  });

  describe("listPlugins", () => {
    it("returns empty array when no plugins", () => {
      expect(listPlugins(mechaDir)).toEqual([]);
    });

    it("returns all plugins", () => {
      addPlugin(mechaDir, pluginName("a"), {
        type: "http",
        url: "http://localhost/a",
        addedAt: "2026-01-01T00:00:00Z",
      });
      addPlugin(mechaDir, pluginName("b"), {
        type: "stdio",
        command: "echo",
        addedAt: "2026-01-01T00:00:00Z",
      });
      const list = listPlugins(mechaDir);
      expect(list).toHaveLength(2);
      expect(list.map((p) => p.name).sort()).toEqual(["a", "b"]);
    });
  });

  describe("error classes", () => {
    it("PluginNotFoundError has correct message", () => {
      const err = new PluginNotFoundError("ghost");
      expect(err.message).toBe('Plugin "ghost" not found');
      expect(err.name).toBe("PluginNotFoundError");
    });

    it("PluginAlreadyExistsError has correct message", () => {
      const err = new PluginAlreadyExistsError("dup");
      expect(err.message).toContain("already exists");
    });

    it("PluginNameReservedError has correct message", () => {
      const err = new PluginNameReservedError("query");
      expect(err.message).toContain("reserved");
    });
  });

  describe("getPlugin", () => {
    it("throws on invalid name", () => {
      expect(() => getPlugin(mechaDir, "INVALID")).toThrow(InvalidNameError);
    });
  });

  describe("isPluginName", () => {
    it("returns false for non-existent plugin", () => {
      expect(isPluginName(mechaDir, "ghost")).toBe(false);
    });

    it("returns false for invalid name", () => {
      expect(isPluginName(mechaDir, "INVALID")).toBe(false);
    });

    it("returns true for registered plugin", () => {
      addPlugin(mechaDir, pluginName("test"), {
        type: "http",
        url: "http://localhost/mcp",
        addedAt: "2026-01-01T00:00:00Z",
      });
      expect(isPluginName(mechaDir, "test")).toBe(true);
    });
  });
});
