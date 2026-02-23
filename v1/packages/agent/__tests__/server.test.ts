import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies before importing
vi.mock("@mecha/process", () => ({
  createProcessManager: () => ({
    list: () => [],
    onEvent: () => () => {},
  }),
}));

vi.mock("@mecha/service", () => ({
  mechaLs: async () => [],
  mechaUp: async () => ({ id: "m1", name: "mecha-m1", port: 7700, authToken: "tok" }),
  mechaRm: async () => undefined,
  mechaStart: async () => undefined,
  mechaStop: async () => undefined,
  mechaSessionList: async () => [],
  mechaSessionCreate: async () => ({ sessionId: "s1" }),
  mechaSessionMessage: async () => ({ body: null }),
}));

vi.mock("@mecha/contracts", () => ({
  toHttpStatus: () => 500,
  toSafeMessage: (err: unknown) => (err instanceof Error ? err.message : "Unknown error"),
}));

vi.mock("node:os", async (importOriginal) => {
  const orig = await importOriginal<typeof import("node:os")>();
  return { ...orig, hostname: () => "test-server" };
});

// Mock node-registry and heartbeat
const mockReadNodes = vi.fn().mockReturnValue([]);
vi.mock("../src/node-registry.js", () => ({
  readNodes: () => mockReadNodes(),
}));

let capturedOpts: { nodes: () => unknown[]; onUpdate: (h: unknown[]) => void } | null = null;
const mockHeartbeatStop = vi.fn();
const mockStartHeartbeat = vi.fn().mockImplementation((opts) => {
  capturedOpts = opts;
  return { stop: mockHeartbeatStop };
});
vi.mock("../src/heartbeat.js", () => ({
  startHeartbeat: (...args: unknown[]) => mockStartHeartbeat(...args),
}));

const { createAgentServer } = await import("../src/server.js");

describe("createAgentServer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedOpts = null;
  });

  it("creates server with start and stop methods", async () => {
    const server = await createAgentServer({ apiKey: "test-key" });
    expect(server.app).toBeDefined();
    expect(typeof server.start).toBe("function");
    expect(typeof server.stop).toBe("function");
  });

  it("start() listens on port and starts heartbeat", async () => {
    const server = await createAgentServer({ apiKey: "test-key", port: 0 });
    await server.start();

    expect(mockStartHeartbeat).toHaveBeenCalledWith(
      expect.objectContaining({
        intervalMs: 15_000,
      }),
    );

    await server.stop();
  });

  it("stop() stops heartbeat and closes app", async () => {
    const server = await createAgentServer({ apiKey: "test-key", port: 0 });
    await server.start();
    await server.stop();

    expect(mockHeartbeatStop).toHaveBeenCalled();
  });

  it("heartbeat nodes callback returns readNodes()", async () => {
    const nodeList = [{ name: "a", host: "1.2.3.4:7660", key: "k1" }];
    mockReadNodes.mockReturnValue(nodeList);

    const server = await createAgentServer({ apiKey: "test-key", port: 0 });
    await server.start();

    expect(capturedOpts).not.toBeNull();
    expect(capturedOpts!.nodes()).toEqual(nodeList);

    await server.stop();
  });

  it("heartbeat onUpdate updates node health exposed by /nodes/health", async () => {
    const server = await createAgentServer({ apiKey: "test-key" });
    // Before start, /nodes/health should return empty
    const resBefore = await server.app.inject({
      method: "GET",
      url: "/nodes/health",
      headers: { authorization: "Bearer test-key" },
    });
    expect(resBefore.json()).toEqual([]);

    await server.start();

    // Simulate heartbeat onUpdate callback
    const health = [{ name: "a", host: "1.2.3.4", status: "online", lastSeen: "2024-01-01", latencyMs: 5, mechaCount: 2 }];
    capturedOpts!.onUpdate(health);

    const resAfter = await server.app.inject({
      method: "GET",
      url: "/nodes/health",
      headers: { authorization: "Bearer test-key" },
    });
    expect(resAfter.json()).toEqual(health);

    await server.stop();
  });

  it("healthz endpoint works without auth", async () => {
    const server = await createAgentServer({ apiKey: "test-key" });
    const res = await server.app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("ok");
    expect(body.node).toBe("test-server");
  });

  it("protected endpoints require auth", async () => {
    const server = await createAgentServer({ apiKey: "secret" });
    const res = await server.app.inject({ method: "GET", url: "/mechas" });
    expect(res.statusCode).toBe(401);
  });

  it("protected endpoints work with valid auth", async () => {
    const server = await createAgentServer({ apiKey: "secret" });
    const res = await server.app.inject({
      method: "GET",
      url: "/mechas",
      headers: { authorization: "Bearer secret" },
    });
    expect(res.statusCode).toBe(200);
  });
});
