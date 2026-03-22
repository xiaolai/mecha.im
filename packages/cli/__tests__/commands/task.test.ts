import { describe, it, expect, vi, beforeEach } from "vitest";
import { Command } from "commander";
import { registerTaskCommand } from "../../src/commands/task.js";
import type { CommandDeps } from "../../src/types.js";

// Mock service layer
vi.mock("@mecha/service", () => ({
  taskCreate: vi.fn().mockResolvedValue({ id: "task-abc12345", status: "pending" }),
  taskGet: vi.fn().mockResolvedValue({
    id: "task-abc12345", source: "admin", target: "analyst", status: "completed",
    message: "Review code", result: "LGTM", createdAt: "2026-03-22T00:00:00Z",
    updatedAt: "2026-03-22T00:01:00Z", durationMs: 1500, costUsd: 0.02, sessionId: "s1",
  }),
  taskCancel: vi.fn().mockResolvedValue(undefined),
  taskList: vi.fn().mockResolvedValue([
    { id: "t1", target: "analyst", status: "completed", message: "Review code", updatedAt: "2026-03-22T00:01:00Z" },
    { id: "t2", target: "coder", status: "working", message: "Write tests", updatedAt: "2026-03-22T00:02:00Z" },
  ]),
}));

// Mock agent-auth
vi.mock("../../src/agent-auth.js", () => ({
  resolveAgentAuth: vi.fn().mockReturnValue({
    agentUrl: "http://127.0.0.1:7660",
    auth: "test-mesh-key",
  }),
}));

const { taskCreate, taskGet, taskCancel, taskList } = await import("@mecha/service");

function makeDeps(): CommandDeps {
  return {
    formatter: {
      success: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      table: vi.fn(),
      json: vi.fn(),
      isJson: false,
      isQuiet: false,
    },
    processManager: {} as never,
    mechaDir: "/tmp/test-mecha",
    acl: {} as never,
    sandbox: {} as never,
  };
}

describe("mecha task", () => {
  let program: Command;
  let deps: CommandDeps;

  beforeEach(() => {
    vi.clearAllMocks();
    program = new Command();
    program.exitOverride();
    deps = makeDeps();
    registerTaskCommand(program, deps);
  });

  describe("create", () => {
    it("creates a task and shows success", async () => {
      await program.parseAsync(["node", "mecha", "task", "create", "analyst", "Review code"]);
      expect(taskCreate).toHaveBeenCalledWith(
        "http://127.0.0.1:7660",
        "test-mesh-key",
        { target: "analyst", message: "Review code" },
      );
      expect(deps.formatter.success).toHaveBeenCalledWith(
        expect.stringContaining("task-abc12345"),
      );
    });
  });

  describe("list", () => {
    it("lists tasks in table format", async () => {
      await program.parseAsync(["node", "mecha", "task", "list"]);
      expect(taskList).toHaveBeenCalled();
      expect(deps.formatter.table).toHaveBeenCalledWith(
        ["ID", "Target", "Status", "Message", "Updated"],
        expect.any(Array),
      );
    });

    it("passes filter options", async () => {
      await program.parseAsync(["node", "mecha", "task", "list", "--target", "analyst", "--status", "working"]);
      expect(taskList).toHaveBeenCalledWith(
        "http://127.0.0.1:7660",
        "test-mesh-key",
        { target: "analyst", status: "working" },
      );
    });
  });

  describe("show", () => {
    it("shows task details", async () => {
      await program.parseAsync(["node", "mecha", "task", "show", "task-abc12345"]);
      expect(taskGet).toHaveBeenCalledWith(
        "http://127.0.0.1:7660",
        "test-mesh-key",
        "task-abc12345",
      );
      expect(deps.formatter.info).toHaveBeenCalledWith(expect.stringContaining("task-abc12345"));
      expect(deps.formatter.info).toHaveBeenCalledWith(expect.stringContaining("LGTM"));
    });
  });

  describe("cancel", () => {
    it("cancels a task", async () => {
      await program.parseAsync(["node", "mecha", "task", "cancel", "task-abc12345"]);
      expect(taskCancel).toHaveBeenCalledWith(
        "http://127.0.0.1:7660",
        "test-mesh-key",
        "task-abc12345",
      );
      expect(deps.formatter.success).toHaveBeenCalledWith(expect.stringContaining("cancelled"));
    });
  });
});
