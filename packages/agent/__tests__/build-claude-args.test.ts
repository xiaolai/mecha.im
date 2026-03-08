import { describe, it, expect } from "vitest";
import { buildClaudeArgs } from "../src/build-claude-args.js";
import type { BotConfig } from "@mecha/core";

describe("buildClaudeArgs", () => {
  it("returns empty array for empty config", () => {
    expect(buildClaudeArgs({})).toEqual([]);
  });

  it("returns empty array for undefined session opts", () => {
    expect(buildClaudeArgs({}, undefined)).toEqual([]);
  });

  // --- Session identity ---

  it("adds --resume for an existing session ID", () => {
    expect(buildClaudeArgs({}, { resume: "abc-123" })).toEqual(["--resume", "abc-123"]);
  });

  it("adds --session-id for a new session with pre-assigned UUID", () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    expect(buildClaudeArgs({}, { newSessionId: uuid })).toEqual(["--session-id", uuid]);
  });

  it("resume takes precedence over newSessionId", () => {
    expect(buildClaudeArgs({}, { resume: "abc-123", newSessionId: "new-uuid" })).toEqual([
      "--resume", "abc-123",
    ]);
  });

  it("skips session flags when session opts has no resume or newSessionId", () => {
    expect(buildClaudeArgs({}, {})).toEqual([]);
  });

  // --- Individual flags ---

  it("adds --model when set", () => {
    expect(buildClaudeArgs({ model: "claude-sonnet-4-20250514" })).toEqual([
      "--model", "claude-sonnet-4-20250514",
    ]);
  });

  it("adds --system-prompt when set", () => {
    expect(buildClaudeArgs({ systemPrompt: "You are helpful" })).toEqual([
      "--system-prompt", "You are helpful",
    ]);
  });

  it("throws when both systemPrompt and appendSystemPrompt are set", () => {
    expect(() => buildClaudeArgs({ systemPrompt: "A", appendSystemPrompt: "B" }))
      .toThrow("systemPrompt and appendSystemPrompt are mutually exclusive");
  });

  it("adds --append-system-prompt when set", () => {
    expect(buildClaudeArgs({ appendSystemPrompt: "Be concise" })).toEqual([
      "--append-system-prompt", "Be concise",
    ]);
  });

  it("adds --effort when set", () => {
    expect(buildClaudeArgs({ effort: "high" })).toEqual(["--effort", "high"]);
  });

  it("adds --max-budget-usd as string", () => {
    expect(buildClaudeArgs({ maxBudgetUsd: 5.5 })).toEqual([
      "--max-budget-usd", "5.5",
    ]);
  });

  it("adds --permission-mode when set", () => {
    expect(buildClaudeArgs({ permissionMode: "plan" })).toEqual([
      "--permission-mode", "plan",
    ]);
  });

  it("throws when both allowedTools and tools are set", () => {
    expect(() => buildClaudeArgs({ allowedTools: ["Bash"], tools: ["Read"] }))
      .toThrow("allowedTools and tools are mutually exclusive");
  });

  it("throws when both disallowedTools and tools are set", () => {
    expect(() => buildClaudeArgs({ disallowedTools: ["Write"], tools: ["Read"] }))
      .toThrow("disallowedTools and tools are mutually exclusive");
  });

  it("adds --allowed-tools with spread items", () => {
    expect(buildClaudeArgs({ allowedTools: ["Bash", "Read"] })).toEqual([
      "--allowed-tools", "Bash", "Read",
    ]);
  });

  it("skips --allowed-tools when array is empty", () => {
    expect(buildClaudeArgs({ allowedTools: [] })).toEqual([]);
  });

  it("adds --disallowed-tools with spread items", () => {
    expect(buildClaudeArgs({ disallowedTools: ["Write"] })).toEqual([
      "--disallowed-tools", "Write",
    ]);
  });

  it("skips --disallowed-tools when array is empty", () => {
    expect(buildClaudeArgs({ disallowedTools: [] })).toEqual([]);
  });

  it("adds --tools with spread items", () => {
    expect(buildClaudeArgs({ tools: ["Bash", "Grep"] })).toEqual([
      "--tools", "Bash", "Grep",
    ]);
  });

  it("skips --tools when array is empty", () => {
    expect(buildClaudeArgs({ tools: [] })).toEqual([]);
  });

  it("adds --add-dir with spread items", () => {
    expect(buildClaudeArgs({ addDirs: ["/a", "/b"] })).toEqual([
      "--add-dir", "/a", "/b",
    ]);
  });

  it("skips --add-dir when array is empty", () => {
    expect(buildClaudeArgs({ addDirs: [] })).toEqual([]);
  });

  it("adds --agent when set", () => {
    expect(buildClaudeArgs({ agent: "reviewer" })).toEqual([
      "--agent", "reviewer",
    ]);
  });

  it("adds --agents as JSON string when entries exist", () => {
    const agents = { helper: { description: "A helper", prompt: "Help me" } };
    const result = buildClaudeArgs({ agents });
    expect(result).toEqual(["--agents", JSON.stringify(agents)]);
  });

  it("skips --agents when object is empty", () => {
    expect(buildClaudeArgs({ agents: {} })).toEqual([]);
  });

  // --- Session persistence ---

  it("adds --no-session-persistence when sessionPersistence is false", () => {
    expect(buildClaudeArgs({ sessionPersistence: false })).toEqual([
      "--no-session-persistence",
    ]);
  });

  it("skips --no-session-persistence when sessionPersistence is true", () => {
    expect(buildClaudeArgs({ sessionPersistence: true })).toEqual([]);
  });

  it("skips --no-session-persistence when sessionPersistence is undefined", () => {
    expect(buildClaudeArgs({})).toEqual([]);
  });

  // --- MCP config ---

  it("adds --mcp-config for inline mcpServers only", () => {
    const mcpServers = { myServer: { command: "node", args: ["server.js"] } };
    const result = buildClaudeArgs({ mcpServers });
    expect(result).toEqual([
      "--mcp-config", JSON.stringify({ mcpServers }),
    ]);
  });

  it("adds --mcp-config for mcpConfigFiles only", () => {
    const result = buildClaudeArgs({ mcpConfigFiles: ["/path/a.json", "/path/b.json"] });
    expect(result).toEqual([
      "--mcp-config", "/path/a.json",
      "--mcp-config", "/path/b.json",
    ]);
  });

  it("adds --mcp-config for both inline and file refs", () => {
    const mcpServers = { s1: { command: "node" } };
    const result = buildClaudeArgs({ mcpServers, mcpConfigFiles: ["/f.json"] });
    expect(result).toEqual([
      "--mcp-config", JSON.stringify({ mcpServers }),
      "--mcp-config", "/f.json",
    ]);
  });

  it("skips --mcp-config when mcpServers is empty and mcpConfigFiles is empty", () => {
    expect(buildClaudeArgs({ mcpServers: {}, mcpConfigFiles: [] })).toEqual([]);
  });

  it("adds --strict-mcp-config when truthy", () => {
    expect(buildClaudeArgs({ strictMcpConfig: true })).toEqual([
      "--strict-mcp-config",
    ]);
  });

  it("skips --strict-mcp-config when falsy", () => {
    expect(buildClaudeArgs({ strictMcpConfig: false })).toEqual([]);
  });

  // --- Plugins ---

  it("adds --plugin-dir with spread items", () => {
    expect(buildClaudeArgs({ pluginDirs: ["/p1", "/p2"] })).toEqual([
      "--plugin-dir", "/p1", "/p2",
    ]);
  });

  it("skips --plugin-dir when array is empty", () => {
    expect(buildClaudeArgs({ pluginDirs: [] })).toEqual([]);
  });

  it("adds --disable-slash-commands when truthy", () => {
    expect(buildClaudeArgs({ disableSlashCommands: true })).toEqual([
      "--disable-slash-commands",
    ]);
  });

  it("skips --disable-slash-commands when falsy", () => {
    expect(buildClaudeArgs({ disableSlashCommands: false })).toEqual([]);
  });

  // --- Combined ---

  it("builds combined args with --resume in correct order", () => {
    const config: Partial<BotConfig> = {
      model: "claude-sonnet-4-20250514",
      effort: "high",
      maxBudgetUsd: 10,
      permissionMode: "plan",
      allowedTools: ["Bash"],
      agent: "coder",
      sessionPersistence: false,
      disableSlashCommands: true,
    };
    const result = buildClaudeArgs(config, { resume: "sess-42" });
    expect(result).toEqual([
      "--resume", "sess-42",
      "--model", "claude-sonnet-4-20250514",
      "--effort", "high",
      "--max-budget-usd", "10",
      "--permission-mode", "plan",
      "--allowed-tools", "Bash",
      "--agent", "coder",
      "--no-session-persistence",
      "--disable-slash-commands",
    ]);
  });

  it("builds combined args with --session-id for new session", () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    const result = buildClaudeArgs({ model: "opus" }, { newSessionId: uuid });
    expect(result).toEqual([
      "--session-id", uuid,
      "--model", "opus",
    ]);
  });
});
