import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { prepareBotFilesystem, type BotFilesystemOpts } from "../src/sandbox-setup.js";

describe("sandbox-setup extended fields", () => {
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

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-sandbox-ext-"));
    botDir = join(tempDir, "bot");
    mechaDir = join(tempDir, "mecha");
    mkdirSync(mechaDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("persists LLM behavior fields to config.json", () => {
    prepareBotFilesystem(makeOpts({
      systemPrompt: "You are a helpful bot.",
      appendSystemPrompt: "Always be concise.",
      effort: "high",
      maxBudgetUsd: 5.0,
    }));
    const config = JSON.parse(readFileSync(join(botDir, "config.json"), "utf-8"));
    expect(config.systemPrompt).toBe("You are a helpful bot.");
    expect(config.appendSystemPrompt).toBe("Always be concise.");
    expect(config.effort).toBe("high");
    expect(config.maxBudgetUsd).toBe(5.0);
  });

  it("persists tool control fields to config.json", () => {
    prepareBotFilesystem(makeOpts({
      allowedTools: ["Read", "Write"],
      disallowedTools: ["Bash"],
      tools: ["mcp__github"],
    }));
    const config = JSON.parse(readFileSync(join(botDir, "config.json"), "utf-8"));
    expect(config.allowedTools).toEqual(["Read", "Write"]);
    expect(config.disallowedTools).toEqual(["Bash"]);
    expect(config.tools).toEqual(["mcp__github"]);
  });

  it("persists agent identity fields to config.json", () => {
    const agents = { reviewer: { description: "Code reviewer", prompt: "Review code carefully" } };
    prepareBotFilesystem(makeOpts({
      agent: "reviewer",
      agents,
    }));
    const config = JSON.parse(readFileSync(join(botDir, "config.json"), "utf-8"));
    expect(config.agent).toBe("reviewer");
    expect(config.agents).toEqual(agents);
  });

  it("persists session behavior fields to config.json", () => {
    prepareBotFilesystem(makeOpts({
      sessionPersistence: true,
      budgetLimit: 10,
    }));
    const config = JSON.parse(readFileSync(join(botDir, "config.json"), "utf-8"));
    expect(config.sessionPersistence).toBe(true);
    expect(config.budgetLimit).toBe(10);
  });

  it("persists MCP and plugin fields to config.json", () => {
    const mcpServers = { github: { command: "npx", args: ["@github/mcp"] } };
    prepareBotFilesystem(makeOpts({
      mcpServers,
      mcpConfigFiles: ["/path/to/mcp.json"],
      strictMcpConfig: true,
      pluginDirs: ["/path/to/plugins"],
      disableSlashCommands: true,
    }));
    const config = JSON.parse(readFileSync(join(botDir, "config.json"), "utf-8"));
    expect(config.mcpServers).toEqual(mcpServers);
    expect(config.mcpConfigFiles).toEqual(["/path/to/mcp.json"]);
    expect(config.strictMcpConfig).toBe(true);
    expect(config.pluginDirs).toEqual(["/path/to/plugins"]);
    expect(config.disableSlashCommands).toBe(true);
  });

  it("persists addDirs to config.json", () => {
    prepareBotFilesystem(makeOpts({
      addDirs: ["/extra/dir1", "/extra/dir2"],
    }));
    const config = JSON.parse(readFileSync(join(botDir, "config.json"), "utf-8"));
    expect(config.addDirs).toEqual(["/extra/dir1", "/extra/dir2"]);
  });

  it("omits undefined fields from config.json", () => {
    prepareBotFilesystem(makeOpts());
    const config = JSON.parse(readFileSync(join(botDir, "config.json"), "utf-8"));
    expect(config).not.toHaveProperty("systemPrompt");
    expect(config).not.toHaveProperty("appendSystemPrompt");
    expect(config).not.toHaveProperty("effort");
    expect(config).not.toHaveProperty("maxBudgetUsd");
    expect(config).not.toHaveProperty("allowedTools");
    expect(config).not.toHaveProperty("disallowedTools");
    expect(config).not.toHaveProperty("tools");
    expect(config).not.toHaveProperty("agent");
    expect(config).not.toHaveProperty("agents");
    expect(config).not.toHaveProperty("sessionPersistence");
    expect(config).not.toHaveProperty("budgetLimit");
    expect(config).not.toHaveProperty("mcpServers");
    expect(config).not.toHaveProperty("mcpConfigFiles");
    expect(config).not.toHaveProperty("strictMcpConfig");
    expect(config).not.toHaveProperty("pluginDirs");
    expect(config).not.toHaveProperty("disableSlashCommands");
    expect(config).not.toHaveProperty("addDirs");
  });
});
