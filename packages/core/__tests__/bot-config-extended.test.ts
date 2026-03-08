import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readBotConfig, updateBotConfig } from "../src/bot-config.js";

const BASE_CONFIG = { port: 7700, token: "tok", workspace: "/ws" };

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "mecha-cfg-ext-"));
}

function writeConfig(dir: string, config: Record<string, unknown>): void {
  writeFileSync(join(dir, "config.json"), JSON.stringify(config));
}

function readConfig(dir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, "config.json"), "utf-8"));
}

describe("BotConfig extended fields", () => {
  let tempDir: string;
  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  describe("LLM behavior fields", () => {
    it("reads systemPrompt", () => {
      tempDir = makeTempDir();
      writeConfig(tempDir, { ...BASE_CONFIG, systemPrompt: "You are a helpful bot." });
      const cfg = readBotConfig(tempDir);
      expect(cfg!.systemPrompt).toBe("You are a helpful bot.");
    });

    it("reads appendSystemPrompt", () => {
      tempDir = makeTempDir();
      writeConfig(tempDir, { ...BASE_CONFIG, appendSystemPrompt: "Always be concise." });
      const cfg = readBotConfig(tempDir);
      expect(cfg!.appendSystemPrompt).toBe("Always be concise.");
    });

    it("reads effort enum", () => {
      tempDir = makeTempDir();
      for (const level of ["low", "medium", "high"] as const) {
        writeConfig(tempDir, { ...BASE_CONFIG, effort: level });
        const cfg = readBotConfig(tempDir);
        expect(cfg!.effort).toBe(level);
      }
    });

    it("rejects invalid effort value", () => {
      tempDir = makeTempDir();
      writeConfig(tempDir, { ...BASE_CONFIG, effort: "ultra" });
      expect(readBotConfig(tempDir)).toBeUndefined();
    });

    it("reads maxBudgetUsd", () => {
      tempDir = makeTempDir();
      writeConfig(tempDir, { ...BASE_CONFIG, maxBudgetUsd: 5.50 });
      const cfg = readBotConfig(tempDir);
      expect(cfg!.maxBudgetUsd).toBe(5.50);
    });

    it("rejects non-positive maxBudgetUsd", () => {
      tempDir = makeTempDir();
      writeConfig(tempDir, { ...BASE_CONFIG, maxBudgetUsd: -1 });
      expect(readBotConfig(tempDir)).toBeUndefined();
    });
  });

  describe("Tool control fields", () => {
    it("reads allowedTools", () => {
      tempDir = makeTempDir();
      writeConfig(tempDir, { ...BASE_CONFIG, allowedTools: ["bash", "read"] });
      const cfg = readBotConfig(tempDir);
      expect(cfg!.allowedTools).toEqual(["bash", "read"]);
    });

    it("reads disallowedTools", () => {
      tempDir = makeTempDir();
      writeConfig(tempDir, { ...BASE_CONFIG, disallowedTools: ["write"] });
      const cfg = readBotConfig(tempDir);
      expect(cfg!.disallowedTools).toEqual(["write"]);
    });

    it("reads tools", () => {
      tempDir = makeTempDir();
      writeConfig(tempDir, { ...BASE_CONFIG, tools: ["bash", "read", "write"] });
      const cfg = readBotConfig(tempDir);
      expect(cfg!.tools).toEqual(["bash", "read", "write"]);
    });
  });

  describe("Agent identity fields", () => {
    it("reads agent preset name", () => {
      tempDir = makeTempDir();
      writeConfig(tempDir, { ...BASE_CONFIG, agent: "coder" });
      const cfg = readBotConfig(tempDir);
      expect(cfg!.agent).toBe("coder");
    });

    it("reads agents record", () => {
      tempDir = makeTempDir();
      const agents = {
        reviewer: { description: "Code reviewer", prompt: "Review code carefully." },
        writer: { description: "Content writer", prompt: "Write engaging content." },
      };
      writeConfig(tempDir, { ...BASE_CONFIG, agents });
      const cfg = readBotConfig(tempDir);
      expect(cfg!.agents).toEqual(agents);
    });

    it("rejects agents with missing prompt field", () => {
      tempDir = makeTempDir();
      writeConfig(tempDir, {
        ...BASE_CONFIG,
        agents: { bad: { description: "no prompt" } },
      });
      expect(readBotConfig(tempDir)).toBeUndefined();
    });
  });

  describe("Session behavior fields", () => {
    it("reads sessionPersistence", () => {
      tempDir = makeTempDir();
      writeConfig(tempDir, { ...BASE_CONFIG, sessionPersistence: false });
      const cfg = readBotConfig(tempDir);
      expect(cfg!.sessionPersistence).toBe(false);
    });

    it("reads budgetLimit", () => {
      tempDir = makeTempDir();
      writeConfig(tempDir, { ...BASE_CONFIG, budgetLimit: 10 });
      const cfg = readBotConfig(tempDir);
      expect(cfg!.budgetLimit).toBe(10);
    });

    it("rejects non-positive budgetLimit", () => {
      tempDir = makeTempDir();
      writeConfig(tempDir, { ...BASE_CONFIG, budgetLimit: 0 });
      expect(readBotConfig(tempDir)).toBeUndefined();
    });
  });

  describe("MCP & plugins fields", () => {
    it("reads mcpServers record", () => {
      tempDir = makeTempDir();
      const mcpServers = {
        filesystem: { command: "npx", args: ["-y", "@mcp/filesystem"] },
      };
      writeConfig(tempDir, { ...BASE_CONFIG, mcpServers });
      const cfg = readBotConfig(tempDir);
      expect(cfg!.mcpServers).toEqual(mcpServers);
    });

    it("reads mcpConfigFiles", () => {
      tempDir = makeTempDir();
      writeConfig(tempDir, { ...BASE_CONFIG, mcpConfigFiles: ["/path/to/mcp.json"] });
      const cfg = readBotConfig(tempDir);
      expect(cfg!.mcpConfigFiles).toEqual(["/path/to/mcp.json"]);
    });

    it("reads strictMcpConfig", () => {
      tempDir = makeTempDir();
      writeConfig(tempDir, { ...BASE_CONFIG, strictMcpConfig: true });
      const cfg = readBotConfig(tempDir);
      expect(cfg!.strictMcpConfig).toBe(true);
    });

    it("reads pluginDirs", () => {
      tempDir = makeTempDir();
      writeConfig(tempDir, { ...BASE_CONFIG, pluginDirs: ["/plugins/a", "/plugins/b"] });
      const cfg = readBotConfig(tempDir);
      expect(cfg!.pluginDirs).toEqual(["/plugins/a", "/plugins/b"]);
    });

    it("reads disableSlashCommands", () => {
      tempDir = makeTempDir();
      writeConfig(tempDir, { ...BASE_CONFIG, disableSlashCommands: true });
      const cfg = readBotConfig(tempDir);
      expect(cfg!.disableSlashCommands).toBe(true);
    });
  });

  describe("Environment fields", () => {
    it("reads addDirs", () => {
      tempDir = makeTempDir();
      writeConfig(tempDir, { ...BASE_CONFIG, addDirs: ["/extra/dir1", "/extra/dir2"] });
      const cfg = readBotConfig(tempDir);
      expect(cfg!.addDirs).toEqual(["/extra/dir1", "/extra/dir2"]);
    });

    it("reads env record", () => {
      tempDir = makeTempDir();
      writeConfig(tempDir, { ...BASE_CONFIG, env: { FOO: "bar", BAZ: "qux" } });
      const cfg = readBotConfig(tempDir);
      expect(cfg!.env).toEqual({ FOO: "bar", BAZ: "qux" });
    });
  });

  describe("Round-trip through updateBotConfig", () => {
    it("round-trips all new fields", () => {
      tempDir = makeTempDir();
      writeConfig(tempDir, BASE_CONFIG);

      const newFields = {
        systemPrompt: "Be helpful.",
        appendSystemPrompt: "Be concise.",
        effort: "high" as const,
        maxBudgetUsd: 10,
        allowedTools: ["bash"],
        disallowedTools: ["write"],
        tools: ["bash", "read"],
        agent: "coder",
        agents: { helper: { description: "A helper", prompt: "Help users." } },
        sessionPersistence: false,
        budgetLimit: 25,
        mcpServers: { fs: { command: "node" } },
        mcpConfigFiles: ["/mcp.json"],
        strictMcpConfig: true,
        pluginDirs: ["/plugins"],
        disableSlashCommands: true,
        addDirs: ["/extra"],
        env: { KEY: "val" },
      };

      updateBotConfig(tempDir, newFields);
      const cfg = readBotConfig(tempDir);

      expect(cfg!.systemPrompt).toBe("Be helpful.");
      expect(cfg!.appendSystemPrompt).toBe("Be concise.");
      expect(cfg!.effort).toBe("high");
      expect(cfg!.maxBudgetUsd).toBe(10);
      expect(cfg!.allowedTools).toEqual(["bash"]);
      expect(cfg!.disallowedTools).toEqual(["write"]);
      expect(cfg!.tools).toEqual(["bash", "read"]);
      expect(cfg!.agent).toBe("coder");
      expect(cfg!.agents).toEqual({ helper: { description: "A helper", prompt: "Help users." } });
      expect(cfg!.sessionPersistence).toBe(false);
      expect(cfg!.budgetLimit).toBe(25);
      expect(cfg!.mcpServers).toEqual({ fs: { command: "node" } });
      expect(cfg!.mcpConfigFiles).toEqual(["/mcp.json"]);
      expect(cfg!.strictMcpConfig).toBe(true);
      expect(cfg!.pluginDirs).toEqual(["/plugins"]);
      expect(cfg!.disableSlashCommands).toBe(true);
      expect(cfg!.addDirs).toEqual(["/extra"]);
      expect(cfg!.env).toEqual({ KEY: "val" });
    });

    it("preserves existing fields when adding new ones", () => {
      tempDir = makeTempDir();
      writeConfig(tempDir, { ...BASE_CONFIG, model: "claude-3", tags: ["prod"] });

      updateBotConfig(tempDir, { effort: "low", env: { A: "1" } });
      const cfg = readBotConfig(tempDir);

      expect(cfg!.model).toBe("claude-3");
      expect(cfg!.tags).toEqual(["prod"]);
      expect(cfg!.effort).toBe("low");
      expect(cfg!.env).toEqual({ A: "1" });
    });
  });
});
