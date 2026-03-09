import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { botConfigure } from "../src/bot.js";
import { BotNotFoundError, type BotName } from "@mecha/core";
import type { ProcessManager, ProcessInfo } from "@mecha/process";

function createMockPM(overrides: Partial<ProcessManager> = {}): ProcessManager {
  return {
    spawn: vi.fn(),
    get: vi.fn().mockReturnValue(undefined),
    list: vi.fn().mockReturnValue([]),
    stop: vi.fn(),
    kill: vi.fn(),
    logs: vi.fn(),
    getPortAndToken: vi.fn(),
    onEvent: vi.fn().mockReturnValue(() => {}),
    ...overrides,
  } as ProcessManager;
}

describe("botConfigure", () => {
  let mechaDir: string;
  afterEach(() => { if (mechaDir) rmSync(mechaDir, { recursive: true, force: true }); });

  it("updates tags", () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-cfg-"));
    const botDir = join(mechaDir, "alice");
    mkdirSync(botDir, { recursive: true });
    writeFileSync(join(botDir, "config.json"), JSON.stringify({ port: 7700, token: "t", workspace: "/ws" }));

    const info: ProcessInfo = { name: "alice" as BotName, state: "running", workspacePath: "/ws", port: 7700 };
    const pm = createMockPM({ get: vi.fn().mockReturnValue(info) });

    botConfigure(mechaDir, pm, "alice" as BotName, { tags: ["research", "papers"] });

    const cfg = JSON.parse(readFileSync(join(botDir, "config.json"), "utf-8"));
    expect(cfg.tags).toEqual(["research", "papers"]);
    expect(cfg.port).toBe(7700);
  });

  it("round-trips new config fields through botConfigure", () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-cfg-"));
    const botDir = join(mechaDir, "alice");
    mkdirSync(botDir, { recursive: true });
    writeFileSync(join(botDir, "config.json"), JSON.stringify({ port: 7700, token: "t", workspace: "/ws" }));

    const info: ProcessInfo = { name: "alice" as BotName, state: "running", workspacePath: "/ws", port: 7700 };
    const pm = createMockPM({ get: vi.fn().mockReturnValue(info) });

    // Use valid combinations (systemPrompt/appendSystemPrompt and allowedTools/tools are mutually exclusive)
    botConfigure(mechaDir, pm, "alice" as BotName, {
      model: "claude-sonnet-4-20250514",
      appendSystemPrompt: "Always be concise.",
      effort: "high",
      maxBudgetUsd: 10,
      allowedTools: ["Read", "Write"],
      disallowedTools: ["Bash"],
      agent: "researcher",
      agents: { helper: { description: "A helper", prompt: "Help the user" } },
      sessionPersistence: true,
      budgetLimit: 5,
      mcpServers: { local: { url: "http://localhost:3000" } },
      mcpConfigFiles: ["/path/to/mcp.json"],
      strictMcpConfig: true,
      pluginDirs: ["/plugins"],
      disableSlashCommands: true,
      addDirs: ["/extra"],
      env: { NODE_ENV: "production" },
      fallbackModel: "claude-haiku-4-5-20251001",
    });

    const cfg = JSON.parse(readFileSync(join(botDir, "config.json"), "utf-8"));
    expect(cfg.model).toBe("claude-sonnet-4-20250514");
    expect(cfg.appendSystemPrompt).toBe("Always be concise.");
    expect(cfg.effort).toBe("high");
    expect(cfg.maxBudgetUsd).toBe(10);
    expect(cfg.allowedTools).toEqual(["Read", "Write"]);
    expect(cfg.disallowedTools).toEqual(["Bash"]);
    expect(cfg.agent).toBe("researcher");
    expect(cfg.agents).toEqual({ helper: { description: "A helper", prompt: "Help the user" } });
    expect(cfg.sessionPersistence).toBe(true);
    expect(cfg.budgetLimit).toBe(5);
    expect(cfg.mcpServers).toEqual({ local: { url: "http://localhost:3000" } });
    expect(cfg.mcpConfigFiles).toEqual(["/path/to/mcp.json"]);
    expect(cfg.strictMcpConfig).toBe(true);
    expect(cfg.pluginDirs).toEqual(["/plugins"]);
    expect(cfg.disableSlashCommands).toBe(true);
    expect(cfg.addDirs).toEqual(["/extra"]);
    expect(cfg.env).toEqual({ NODE_ENV: "production" });
    expect(cfg.fallbackModel).toBe("claude-haiku-4-5-20251001");
    // Original fields preserved
    expect(cfg.port).toBe(7700);
    expect(cfg.workspace).toBe("/ws");
  });

  it("throws BotNotFoundError for unknown bot", () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-cfg-"));
    const pm = createMockPM();
    expect(() => botConfigure(mechaDir, pm, "unknown" as BotName, { tags: ["x"] })).toThrow(BotNotFoundError);
  });
});
