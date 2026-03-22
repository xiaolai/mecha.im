import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { taskCreate, taskGet, taskCancel, taskList } from "../src/task-ops.js";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: async () => data,
  };
}

describe("task-ops", () => {
  const agentUrl = "http://127.0.0.1:7660";
  const auth = "Bearer test-key";

  beforeEach(() => { vi.clearAllMocks(); });

  describe("taskCreate", () => {
    it("creates a task and returns id", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ id: "task-abc", status: "pending" }));
      const result = await taskCreate(agentUrl, auth, { target: "analyst", message: "Review" });
      expect(result.id).toBe("task-abc");
      expect(result.status).toBe("pending");
      expect(mockFetch).toHaveBeenCalledWith(
        "http://127.0.0.1:7660/tasks",
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("throws on error response", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ error: "Bot not found" }, 404));
      await expect(taskCreate(agentUrl, auth, { target: "nobody", message: "hi" }))
        .rejects.toThrow("Bot not found");
    });
  });

  describe("taskGet", () => {
    it("returns a task", async () => {
      const task = { id: "task-abc", source: "admin", target: "analyst", status: "completed", message: "Review", result: "LGTM", createdAt: "2026-01-01", updatedAt: "2026-01-01" };
      mockFetch.mockResolvedValueOnce(jsonResponse(task));
      const result = await taskGet(agentUrl, auth, "task-abc");
      expect(result.id).toBe("task-abc");
      expect(result.result).toBe("LGTM");
    });

    it("throws on 404", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ error: "Not found" }, 404));
      await expect(taskGet(agentUrl, auth, "nope")).rejects.toThrow("Not found");
    });
  });

  describe("taskCancel", () => {
    it("cancels a task", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ cancelled: true }));
      await expect(taskCancel(agentUrl, auth, "task-abc")).resolves.toBeUndefined();
      expect(mockFetch).toHaveBeenCalledWith(
        "http://127.0.0.1:7660/tasks/task-abc/cancel",
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("throws on 409 conflict", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ error: "Already completed" }, 409));
      await expect(taskCancel(agentUrl, auth, "task-abc")).rejects.toThrow("Already completed");
    });
  });

  describe("taskList", () => {
    it("lists all tasks", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse([
        { id: "t1", status: "pending" },
        { id: "t2", status: "completed" },
      ]));
      const tasks = await taskList(agentUrl, auth);
      expect(tasks).toHaveLength(2);
      expect(mockFetch).toHaveBeenCalledWith(
        "http://127.0.0.1:7660/tasks",
        expect.anything(),
      );
    });

    it("passes filter query params", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse([]));
      await taskList(agentUrl, auth, { target: "analyst", status: "working" });
      expect(mockFetch).toHaveBeenCalledWith(
        "http://127.0.0.1:7660/tasks?target=analyst&status=working",
        expect.anything(),
      );
    });
  });

  describe("auth headers", () => {
    it("sends Bearer token", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse([]));
      await taskList(agentUrl, "my-key");
      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers.authorization).toBe("Bearer my-key");
    });

    it("sends session cookie", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse([]));
      await taskList(agentUrl, "mecha-session=abc123");
      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers.cookie).toBe("mecha-session=abc123");
    });
  });
});
