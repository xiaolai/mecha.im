import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registerTaskRoutes } from "../../src/routes/tasks.js";

// Mock sdkChat + task-runner at module level
vi.mock("../../src/sdk-chat.js", () => ({
  sdkChat: vi.fn(),
}));

const { sdkChat } = await import("../../src/sdk-chat.js");
const mockSdkChat = vi.mocked(sdkChat);

describe("runtime task routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    // Simple Bearer auth for tests
    app.addHook("onRequest", async (req, reply) => {
      if (req.url === "/healthz") return;
      const auth = req.headers.authorization;
      if (auth !== "Bearer test-token") {
        reply.code(401).send({ error: "Unauthorized" });
      }
    });
    registerTaskRoutes(app, {
      sdkChatOpts: { workspacePath: "/tmp/test" },
      botName: "analyst",
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const headers = { authorization: "Bearer test-token", "content-type": "application/json" };

  it("POST /api/tasks returns 202 and starts execution", async () => {
    mockSdkChat.mockResolvedValueOnce({
      response: "done", sessionId: "s1", durationMs: 100, costUsd: 0.01,
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers,
      payload: { taskId: "t-001", message: "Review code" },
    });

    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.accepted).toBe(true);
    expect(body.taskId).toBe("t-001");
  });

  it("POST /api/tasks returns 400 for missing taskId", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers,
      payload: { message: "hello" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /api/tasks returns 400 for missing message", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers,
      payload: { taskId: "t-002" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("GET /api/tasks/:id/status returns running for active task", async () => {
    // Start a task that never resolves
    mockSdkChat.mockImplementationOnce(() => new Promise(() => {}));

    await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers,
      payload: { taskId: "t-running", message: "Long task" },
    });

    // Small delay for async start
    await new Promise((r) => setTimeout(r, 10));

    const res = await app.inject({
      method: "GET",
      url: "/api/tasks/t-running/status",
      headers,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().running).toBe(true);
    expect(res.json().status).toBe("working");

    // Clean up — cancel it
    const { cancelTask } = await import("../../src/task-runner.js");
    cancelTask("t-running");
  });

  it("GET /api/tasks/:id/status returns result for completed task", async () => {
    mockSdkChat.mockResolvedValueOnce({
      response: "All good", sessionId: "s1", durationMs: 50, costUsd: 0.005,
    });

    await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers,
      payload: { taskId: "t-done", message: "Quick task" },
    });

    // Wait for completion
    await new Promise((r) => setTimeout(r, 50));

    const res = await app.inject({
      method: "GET",
      url: "/api/tasks/t-done/status",
      headers,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.running).toBe(false);
    expect(body.status).toBe("completed");
    expect(body.result).toBe("All good");
  });

  it("GET /api/tasks/:id/status returns 404 for unknown task", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/tasks/nonexistent/status",
      headers,
    });
    expect(res.statusCode).toBe(404);
  });

  it("POST /api/tasks/:id/cancel cancels a running task", async () => {
    mockSdkChat.mockImplementationOnce((_opts, _msg, _sid, signal) =>
      new Promise((_resolve, reject) => {
        signal!.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }),
    );

    await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers,
      payload: { taskId: "t-cancel", message: "Cancel me" },
    });

    await new Promise((r) => setTimeout(r, 10));

    const res = await app.inject({
      method: "POST",
      url: "/api/tasks/t-cancel/cancel",
      headers: { ...headers, "content-type": "application/json" },
      payload: "{}",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().cancelled).toBe(true);
  });

  it("POST /api/tasks/:id/cancel returns 404 for unknown task", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/tasks/nonexistent/cancel",
      headers: { ...headers, "content-type": "application/json" },
      payload: "{}",
    });
    expect(res.statusCode).toBe(404);
  });

  it("rejects requests without auth", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: { "content-type": "application/json" },
      payload: { taskId: "x", message: "y" },
    });
    expect(res.statusCode).toBe(401);
  });
});
