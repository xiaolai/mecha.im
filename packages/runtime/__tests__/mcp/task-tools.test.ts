import { describe, it, expect, vi, beforeEach } from "vitest";
import { TASK_TOOLS, handleTaskTool } from "../../src/mcp/task-tools.js";

// Mock resolveAgent to avoid needing a real agent.json
vi.mock("node:fs", async (importOriginal) => {
  const orig = await importOriginal<typeof import("node:fs")>();
  return {
    ...orig,
    existsSync: vi.fn().mockReturnValue(true),
    readFileSync: vi.fn().mockReturnValue(JSON.stringify({ port: 7660, host: "127.0.0.1" })),
  };
});

vi.mock("@mecha/core", async (importOriginal) => {
  const orig = await importOriginal<Record<string, unknown>>();
  return {
    ...orig,
    readTotpSecret: vi.fn().mockReturnValue("JBSWY3DPEHPK3PXP"),
  };
});

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "OK",
    json: async () => data,
  };
}

const opts = { mechaDir: "/tmp/test-mecha", botName: "coder" };

describe("TASK_TOOLS", () => {
  it("defines 4 tools", () => {
    expect(TASK_TOOLS).toHaveLength(4);
    expect(TASK_TOOLS.map((t) => t.name)).toEqual(["task_create", "task_status", "task_cancel", "task_list"]);
  });
});

describe("handleTaskTool", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("task_create sends POST to agent and returns task ID", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ id: "task-abc", status: "pending" }));
    const result = await handleTaskTool(opts, "task_create", { target: "analyst", message: "Review" });
    expect(result.content[0].text).toContain("task-abc");
    expect(result.isError).toBeUndefined();
  });

  it("task_create returns error for missing target", async () => {
    const result = await handleTaskTool(opts, "task_create", { message: "hello" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("target");
  });

  it("task_status returns task details", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({
      id: "task-abc", status: "completed", result: "LGTM",
    }));
    const result = await handleTaskTool(opts, "task_status", { taskId: "task-abc" });
    expect(result.content[0].text).toContain("completed");
    expect(result.content[0].text).toContain("LGTM");
  });

  it("task_cancel sends POST cancel", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ cancelled: true }));
    const result = await handleTaskTool(opts, "task_cancel", { taskId: "task-abc" });
    expect(result.content[0].text).toContain("cancelled");
  });

  it("task_list returns task array", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse([
      { id: "t1", status: "pending" },
    ]));
    const result = await handleTaskTool(opts, "task_list", {});
    expect(result.content[0].text).toContain("t1");
  });

  it("task_list with filters passes query params", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse([]));
    const result = await handleTaskTool(opts, "task_list", { target: "analyst", status: "working" });
    expect(result.content[0].text).toContain("No tasks found");
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("target=analyst");
    expect(url).toContain("status=working");
  });

  it("returns error for unknown tool", async () => {
    const result = await handleTaskTool(opts, "unknown_tool", {});
    expect(result.isError).toBe(true);
  });
});
