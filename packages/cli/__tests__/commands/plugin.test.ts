import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createProgram } from "../../src/program.js";
import { makeDeps } from "../test-utils.js";
import { listPlugins, getPlugin } from "@mecha/core";

describe("plugin commands", () => {
  let mechaDir: string;

  beforeEach(() => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-cli-plugin-"));
  });
  afterEach(() => {
    rmSync(mechaDir, { recursive: true, force: true });
    process.exitCode = undefined as unknown as number;
  });

  describe("plugin add", () => {
    it("adds an http plugin with --url", async () => {
      const deps = makeDeps({ mechaDir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync([
        "node", "mecha", "plugin", "add", "chrome-bridge",
        "--url", "http://127.0.0.1:7890/mcp",
      ]);
      expect(deps.formatter.success).toHaveBeenCalledWith("Plugin added: chrome-bridge (http)");

      const plugin = getPlugin(mechaDir, "chrome-bridge");
      expect(plugin).toBeDefined();
      expect(plugin!.type).toBe("http");
      if (plugin!.type === "http" || plugin!.type === "sse") {
        expect(plugin!.url).toBe("http://127.0.0.1:7890/mcp");
      }
    });

    it("adds an sse plugin with --url --type sse", async () => {
      const deps = makeDeps({ mechaDir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync([
        "node", "mecha", "plugin", "add", "events",
        "--url", "http://127.0.0.1:8000/sse", "--type", "sse",
      ]);
      expect(deps.formatter.success).toHaveBeenCalledWith("Plugin added: events (sse)");

      const plugin = getPlugin(mechaDir, "events");
      expect(plugin!.type).toBe("sse");
    });

    it("adds a stdio plugin with --command", async () => {
      const deps = makeDeps({ mechaDir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync([
        "node", "mecha", "plugin", "add", "filesystem",
        "--command", "npx", "--args", "-y,@anthropic/mcp-fs,~/docs",
      ]);
      expect(deps.formatter.success).toHaveBeenCalledWith("Plugin added: filesystem (stdio)");

      const plugin = getPlugin(mechaDir, "filesystem");
      expect(plugin).toBeDefined();
      expect(plugin!.type).toBe("stdio");
      if (plugin!.type === "stdio") {
        expect(plugin!.command).toBe("npx");
        expect(plugin!.args).toEqual(["-y", "@anthropic/mcp-fs", "~/docs"]);
      }
    });

    it("adds a stdio plugin with --env", async () => {
      const deps = makeDeps({ mechaDir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync([
        "node", "mecha", "plugin", "add", "github",
        "--command", "npx", "--args", "-y,@mcp/server-github",
        "--env", "GITHUB_TOKEN=ghp_abc123",
      ]);
      const plugin = getPlugin(mechaDir, "github");
      expect(plugin!.type).toBe("stdio");
      if (plugin!.type === "stdio") {
        expect(plugin!.env).toEqual({ GITHUB_TOKEN: "ghp_abc123" });
      }
    });

    it("adds a plugin with description", async () => {
      const deps = makeDeps({ mechaDir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync([
        "node", "mecha", "plugin", "add", "chrome-bridge",
        "--url", "http://127.0.0.1:7890/mcp",
        "-d", "Chrome browser automation",
      ]);
      const plugin = getPlugin(mechaDir, "chrome-bridge");
      expect(plugin!.description).toBe("Chrome browser automation");
    });

    it("rejects duplicate name without --force", async () => {
      const deps = makeDeps({ mechaDir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync([
        "node", "mecha", "plugin", "add", "chrome-bridge",
        "--url", "http://127.0.0.1:7890/mcp",
      ]);
      await program.parseAsync([
        "node", "mecha", "plugin", "add", "chrome-bridge",
        "--url", "http://127.0.0.1:9000/mcp",
      ]);
      expect(deps.formatter.error).toHaveBeenCalledWith(expect.stringMatching(/already exists/));
      expect(process.exitCode).toBe(1);
    });

    it("overwrites with --force", async () => {
      const deps = makeDeps({ mechaDir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync([
        "node", "mecha", "plugin", "add", "chrome-bridge",
        "--url", "http://127.0.0.1:7890/mcp",
      ]);
      await program.parseAsync([
        "node", "mecha", "plugin", "add", "chrome-bridge",
        "--url", "http://127.0.0.1:9000/mcp", "--force",
      ]);
      expect(deps.formatter.success).toHaveBeenCalledTimes(2);

      const plugin = getPlugin(mechaDir, "chrome-bridge");
      if (plugin!.type === "http" || plugin!.type === "sse") {
        expect(plugin!.url).toBe("http://127.0.0.1:9000/mcp");
      }
    });

    it("rejects reserved names (capability names)", async () => {
      const deps = makeDeps({ mechaDir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync([
        "node", "mecha", "plugin", "add", "query",
        "--url", "http://127.0.0.1:7890/mcp",
      ]);
      expect(deps.formatter.error).toHaveBeenCalledWith(expect.stringMatching(/reserved/));
      expect(process.exitCode).toBe(1);
    });

    it("rejects reserved name 'mecha'", async () => {
      const deps = makeDeps({ mechaDir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync([
        "node", "mecha", "plugin", "add", "mecha",
        "--url", "http://127.0.0.1:7890/mcp",
      ]);
      expect(deps.formatter.error).toHaveBeenCalledWith(expect.stringMatching(/reserved/));
    });

    it("rejects invalid name", async () => {
      const deps = makeDeps({ mechaDir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync([
        "node", "mecha", "plugin", "add", "INVALID_NAME",
        "--url", "http://127.0.0.1:7890/mcp",
      ]);
      expect(deps.formatter.error).toHaveBeenCalledWith(expect.stringMatching(/Invalid name/));
    });

    it("errors when neither --url nor --command provided", async () => {
      const deps = makeDeps({ mechaDir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync([
        "node", "mecha", "plugin", "add", "broken",
      ]);
      expect(deps.formatter.error).toHaveBeenCalledWith(
        expect.stringContaining("--url"),
      );
      expect(process.exitCode).toBe(1);
    });

    it("errors when stdio but no --command", async () => {
      const deps = makeDeps({ mechaDir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync([
        "node", "mecha", "plugin", "add", "broken", "--type", "stdio",
      ]);
      expect(deps.formatter.error).toHaveBeenCalledWith(
        expect.stringContaining("--command"),
      );
    });

    it("errors when http but no --url", async () => {
      const deps = makeDeps({ mechaDir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync([
        "node", "mecha", "plugin", "add", "broken",
        "--type", "http", "--command", "npx",
      ]);
      expect(deps.formatter.error).toHaveBeenCalledWith(
        expect.stringContaining("--url"),
      );
    });

    it("rejects malformed env key=value (empty key)", async () => {
      const deps = makeDeps({ mechaDir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync([
        "node", "mecha", "plugin", "add", "bad-env",
        "--command", "npx", "--env", "=nokey",
      ]);
      expect(deps.formatter.error).toHaveBeenCalledWith(
        expect.stringContaining("KEY=VALUE"),
      );
      expect(process.exitCode).toBe(1);
    });

    it("persists registry with addedAt timestamp", async () => {
      const deps = makeDeps({ mechaDir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync([
        "node", "mecha", "plugin", "add", "test-plugin",
        "--url", "http://localhost:8080/mcp",
      ]);

      const raw = JSON.parse(readFileSync(join(mechaDir, "plugins.json"), "utf-8"));
      expect(raw.version).toBe(1);
      expect(raw.plugins["test-plugin"].addedAt).toBeDefined();
    });

    it("adds http plugin with --header", async () => {
      const deps = makeDeps({ mechaDir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync([
        "node", "mecha", "plugin", "add", "authed",
        "--url", "http://localhost:8080/mcp",
        "--header", "Authorization=Bearer tok123",
      ]);
      const plugin = getPlugin(mechaDir, "authed");
      if (plugin!.type === "http" || plugin!.type === "sse") {
        expect(plugin!.headers).toEqual({ Authorization: "Bearer tok123" });
      }
    });
  });

  describe("plugin rm", () => {
    it("removes an existing plugin", async () => {
      const deps = makeDeps({ mechaDir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync([
        "node", "mecha", "plugin", "add", "chrome-bridge",
        "--url", "http://127.0.0.1:7890/mcp",
      ]);
      await program.parseAsync(["node", "mecha", "plugin", "rm", "chrome-bridge"]);
      expect(deps.formatter.success).toHaveBeenCalledWith("Plugin removed: chrome-bridge");
      expect(listPlugins(mechaDir)).toHaveLength(0);
    });

    it("reports error when plugin not found", async () => {
      const deps = makeDeps({ mechaDir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "plugin", "rm", "ghost"]);
      expect(deps.formatter.error).toHaveBeenCalledWith(expect.stringMatching(/not found/));
      expect(process.exitCode).toBe(1);
    });
  });

  describe("plugin ls", () => {
    it("shows message when no plugins", async () => {
      const deps = makeDeps({ mechaDir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "plugin", "ls"]);
      expect(deps.formatter.info).toHaveBeenCalledWith("No plugins registered");
    });

    it("shows table of registered plugins", async () => {
      const deps = makeDeps({ mechaDir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync([
        "node", "mecha", "plugin", "add", "chrome-bridge",
        "--url", "http://127.0.0.1:7890/mcp", "-d", "Chrome",
      ]);
      await program.parseAsync([
        "node", "mecha", "plugin", "add", "filesystem",
        "--command", "npx", "--args", "-y,@anthropic/mcp-fs",
      ]);
      await program.parseAsync(["node", "mecha", "plugin", "ls"]);
      expect(deps.formatter.table).toHaveBeenCalledWith(
        ["Name", "Type", "URL/Command", "Description"],
        expect.arrayContaining([
          expect.arrayContaining(["chrome-bridge", "http"]),
          expect.arrayContaining(["filesystem", "stdio"]),
        ]),
      );
    });

    it("shows stdio plugin without args", async () => {
      const deps = makeDeps({ mechaDir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync([
        "node", "mecha", "plugin", "add", "bare-cmd",
        "--command", "my-server",
      ]);
      await program.parseAsync(["node", "mecha", "plugin", "ls"]);
      expect(deps.formatter.table).toHaveBeenCalledWith(
        ["Name", "Type", "URL/Command", "Description"],
        expect.arrayContaining([
          ["bare-cmd", "stdio", "my-server", ""],
        ]),
      );
    });
  });

  describe("plugin status", () => {
    it("reports error for unknown plugin", async () => {
      const deps = makeDeps({ mechaDir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "plugin", "status", "ghost"]);
      expect(deps.formatter.error).toHaveBeenCalledWith(expect.stringMatching(/not found/));
    });

    it("checks http plugin status (unreachable)", async () => {
      const deps = makeDeps({ mechaDir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync([
        "node", "mecha", "plugin", "add", "web",
        "--url", "http://127.0.0.1:19999/mcp",
      ]);
      await program.parseAsync(["node", "mecha", "plugin", "status", "web"]);
      // HTTP call fails since no server is running — error is expected
      expect(deps.formatter.error).toHaveBeenCalledWith(
        expect.stringContaining("web:"),
      );
    });

    it("shows info for stdio plugin", async () => {
      const deps = makeDeps({ mechaDir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync([
        "node", "mecha", "plugin", "add", "fs",
        "--command", "npx", "--args", "-y,mcp-fs",
      ]);
      await program.parseAsync(["node", "mecha", "plugin", "status", "fs"]);
      expect(deps.formatter.info).toHaveBeenCalledWith(
        expect.stringContaining("stdio plugin"),
      );
    });
  });

  describe("plugin test", () => {
    it("reports error for unknown plugin", async () => {
      const deps = makeDeps({ mechaDir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "plugin", "test", "ghost"]);
      expect(deps.formatter.error).toHaveBeenCalledWith(expect.stringMatching(/not found/));
    });

    it("validates stdio plugin config", async () => {
      const deps = makeDeps({ mechaDir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync([
        "node", "mecha", "plugin", "add", "fs",
        "--command", "npx", "--args", "-y,mcp-fs",
      ]);
      await program.parseAsync(["node", "mecha", "plugin", "test", "fs"]);
      expect(deps.formatter.info).toHaveBeenCalledWith(
        expect.stringContaining("config valid"),
      );
    });

    it("tests http plugin (unreachable)", async () => {
      const deps = makeDeps({ mechaDir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync([
        "node", "mecha", "plugin", "add", "web",
        "--url", "http://127.0.0.1:19999/mcp",
      ]);
      await program.parseAsync(["node", "mecha", "plugin", "test", "web"]);
      // HTTP call fails since no server is running
      expect(deps.formatter.error).toHaveBeenCalledWith(
        expect.stringContaining("web:"),
      );
    });

    it("reports missing env var for stdio plugin", async () => {
      const deps = makeDeps({ mechaDir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync([
        "node", "mecha", "plugin", "add", "github",
        "--command", "npx", "--args", "-y,mcp-github",
        "--env", "TOKEN=${DEFINITELY_NOT_SET_XYZ}",
      ]);
      delete process.env.DEFINITELY_NOT_SET_XYZ;
      await program.parseAsync(["node", "mecha", "plugin", "test", "github"]);
      expect(deps.formatter.error).toHaveBeenCalledWith(
        expect.stringContaining("DEFINITELY_NOT_SET_XYZ"),
      );
      expect(process.exitCode).toBe(1);
    });
  });
});
