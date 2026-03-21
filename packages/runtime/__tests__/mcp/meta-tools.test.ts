import { describe, it, expect, vi } from "vitest";
import { handleMetaTool, META_TOOLS, type MetaToolOpts } from "../../src/mcp/meta-tools.js";
import type { ProcessManager, ProcessInfo } from "@mecha/process";

function createMockProcessManager(overrides?: Partial<ProcessManager>): ProcessManager {
  return {
    spawn: vi.fn().mockResolvedValue({
      name: "test-bot",
      state: "running",
      pid: 12345,
      port: 7700,
      workspacePath: "/workspace",
    } satisfies ProcessInfo),
    get: vi.fn(),
    list: vi.fn().mockReturnValue([]),
    stop: vi.fn().mockResolvedValue(undefined),
    kill: vi.fn().mockResolvedValue(undefined),
    logs: vi.fn(),
    getPortAndToken: vi.fn(),
    onEvent: vi.fn().mockReturnValue(() => {}),
    ...overrides,
  };
}

describe("meta_spawn_bot", () => {
  it("spawns a bot with required fields", async () => {
    const pm = createMockProcessManager();
    const opts: MetaToolOpts = { processManager: pm };

    const result = await handleMetaTool(opts, "meta_spawn_bot", {
      name: "new-bot",
      workspace: "/projects/test",
    });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.name).toBe("test-bot");
    expect(parsed.state).toBe("running");
    expect(parsed.pid).toBe(12345);
    expect(parsed.port).toBe(7700);

    expect(pm.spawn).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "new-bot",
        workspacePath: "/projects/test",
      }),
    );
  });

  it("passes optional model, tags, and systemPrompt", async () => {
    const pm = createMockProcessManager();
    const opts: MetaToolOpts = { processManager: pm };

    await handleMetaTool(opts, "meta_spawn_bot", {
      name: "smart-bot",
      workspace: "/projects/ai",
      model: "claude-sonnet-4-20250514",
      tags: ["research", "code"],
      systemPrompt: "You are a research assistant.",
    });

    expect(pm.spawn).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "smart-bot",
        workspacePath: "/projects/ai",
        model: "claude-sonnet-4-20250514",
        tags: ["research", "code"],
        systemPrompt: "You are a research assistant.",
      }),
    );
  });

  it("returns error when name is missing", async () => {
    const pm = createMockProcessManager();
    const opts: MetaToolOpts = { processManager: pm };

    const result = await handleMetaTool(opts, "meta_spawn_bot", {
      workspace: "/projects/test",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Missing required: name");
    expect(pm.spawn).not.toHaveBeenCalled();
  });

  it("returns error when workspace is missing", async () => {
    const pm = createMockProcessManager();
    const opts: MetaToolOpts = { processManager: pm };

    const result = await handleMetaTool(opts, "meta_spawn_bot", {
      name: "new-bot",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Missing required: workspace");
    expect(pm.spawn).not.toHaveBeenCalled();
  });

  it("returns error when spawn fails", async () => {
    const pm = createMockProcessManager({
      spawn: vi.fn().mockRejectedValue(new Error("Port conflict")),
    });
    const opts: MetaToolOpts = { processManager: pm };

    const result = await handleMetaTool(opts, "meta_spawn_bot", {
      name: "new-bot",
      workspace: "/projects/test",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Failed to spawn bot");
    expect(result.content[0].text).toContain("Port conflict");
  });

  it("filters non-string tags", async () => {
    const pm = createMockProcessManager();
    const opts: MetaToolOpts = { processManager: pm };

    await handleMetaTool(opts, "meta_spawn_bot", {
      name: "bot",
      workspace: "/ws",
      tags: ["valid", 123, "also-valid"],
    });

    expect(pm.spawn).toHaveBeenCalledWith(
      expect.objectContaining({
        tags: ["valid", "also-valid"],
      }),
    );
  });
});

describe("meta_kill_bot", () => {
  it("kills a bot by name", async () => {
    const pm = createMockProcessManager();
    const opts: MetaToolOpts = { processManager: pm };

    const result = await handleMetaTool(opts, "meta_kill_bot", {
      name: "old-bot",
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toBe('Bot "old-bot" killed successfully');
    expect(pm.kill).toHaveBeenCalledWith("old-bot");
  });

  it("returns error when name is missing", async () => {
    const pm = createMockProcessManager();
    const opts: MetaToolOpts = { processManager: pm };

    const result = await handleMetaTool(opts, "meta_kill_bot", {});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Missing required: name");
    expect(pm.kill).not.toHaveBeenCalled();
  });

  it("returns error when kill fails", async () => {
    const pm = createMockProcessManager({
      kill: vi.fn().mockRejectedValue(new Error("Bot not found: ghost")),
    });
    const opts: MetaToolOpts = { processManager: pm };

    const result = await handleMetaTool(opts, "meta_kill_bot", {
      name: "ghost",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Failed to kill bot");
    expect(result.content[0].text).toContain("Bot not found: ghost");
  });
});

describe("unknown meta tool", () => {
  it("returns error for unknown tool name", async () => {
    const pm = createMockProcessManager();
    const opts: MetaToolOpts = { processManager: pm };

    const result = await handleMetaTool(opts, "meta_unknown", {});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Unknown meta tool");
  });
});

describe("META_TOOLS definitions", () => {
  it("exports two tool definitions", () => {
    expect(META_TOOLS).toHaveLength(2);
    const names = META_TOOLS.map((t) => t.name);
    expect(names).toContain("meta_spawn_bot");
    expect(names).toContain("meta_kill_bot");
  });

  it("has required fields in input schemas", () => {
    const spawnTool = META_TOOLS.find((t) => t.name === "meta_spawn_bot")!;
    expect((spawnTool.inputSchema as { required: string[] }).required).toEqual(["name", "workspace"]);

    const killTool = META_TOOLS.find((t) => t.name === "meta_kill_bot")!;
    expect((killTool.inputSchema as { required: string[] }).required).toEqual(["name"]);
  });
});
