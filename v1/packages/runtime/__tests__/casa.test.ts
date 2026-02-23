import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { createServer } from "../src/server.js";
import type { MechaId } from "@mecha/core";

let shouldThrowOnImport = false;
const mockQuery = vi.fn();

vi.mock("@anthropic-ai/claude-agent-sdk", () => {
  return {
    get query() {
      if (shouldThrowOnImport) throw new Error("SDK not available");
      return (...args: unknown[]) => mockQuery(...args);
    },
  };
});

const TEST_ID = "mx-test-casa" as MechaId;

function createTestApp(opts?: { withAgent?: boolean }) {
  return createServer({
    mechaId: TEST_ID,
    skipMcp: true,
    skipAuth: true,
    ...(opts?.withAgent !== false
      ? { agent: { workingDirectory: "/tmp", permissionMode: "default" as const } }
      : {}),
  });
}

describe("Agent routes (casa.ts)", () => {
  let app: ReturnType<typeof createServer>;

  beforeEach(() => {
    shouldThrowOnImport = false;
    mockQuery.mockReset();
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it("POST /api/chat without message returns 400", async () => {
    app = createTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain("Missing");
  });

  it("POST /api/chat with null body returns 400", async () => {
    app = createTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/chat",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify(null),
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /api/chat without agent config returns 503", async () => {
    app = createTestApp({ withAgent: false });
    const res = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { message: "hello" },
    });
    expect(res.statusCode).toBe(503);
    expect(JSON.parse(res.body).error).toContain("not configured");
  });

  it("POST /api/chat streams SSE response from SDK", async () => {
    app = createTestApp();

    mockQuery.mockReturnValue(
      (async function* () {
        yield { type: "assistant", message: { content: [{ type: "text", text: "Hello back" }] } };
      })(),
    );

    const res = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { message: "hello" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/event-stream");
    expect(res.body).toContain("data: ");
    expect(res.body).toContain("[DONE]");
  });

  it("POST /api/chat handles SDK import failure (pre-headers)", async () => {
    app = createTestApp();
    shouldThrowOnImport = true;

    const res = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { message: "hello" },
    });

    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error).toContain("SDK not available");
  });

  it("POST /api/chat handles error during streaming", async () => {
    app = createTestApp();

    mockQuery.mockReturnValue(
      (async function* () {
        yield { type: "assistant", message: { content: [{ type: "text", text: "partial" }] } };
        throw new Error("Stream error");
      })(),
    );

    const res = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { message: "hello" },
    });

    // Headers already sent, so status is 200 — stream just ends
    expect(res.statusCode).toBe(200);
  });

  it("POST /api/chat passes correct options to SDK query", async () => {
    app = createTestApp();

    mockQuery.mockReturnValue(
      (async function* () {
        yield { type: "assistant", message: { content: [{ type: "text", text: "ok" }] } };
      })(),
    );

    await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { message: "test message" },
    });

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const args = mockQuery.mock.calls[0][0];
    expect(args.prompt).toBe("test message");
    expect(args.options.cwd).toBe("/tmp");
    expect(args.options.permissionMode).toBe("default");
    expect(args.options.abortController).toBeInstanceOf(AbortController);
  });

  it("POST /api/chat uses default working directory when not specified", async () => {
    app = createServer({
      mechaId: TEST_ID,
      skipMcp: true,
      skipAuth: true,
      agent: { permissionMode: "default" as const },
    });

    mockQuery.mockReturnValue(
      (async function* () {
        yield { type: "other" };
      })(),
    );

    await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { message: "test" },
    });

    const args = mockQuery.mock.calls[0][0];
    expect(args.options.cwd).toBe(process.cwd());
  });

  it("POST /api/chat uses default permission when not specified", async () => {
    app = createServer({
      mechaId: TEST_ID,
      skipMcp: true,
      skipAuth: true,
      agent: {},
    });

    mockQuery.mockReturnValue(
      (async function* () {
        yield { type: "other" };
      })(),
    );

    await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { message: "test" },
    });

    const args = mockQuery.mock.calls[0][0];
    expect(args.options.permissionMode).toBe("default");
  });

  it("POST /api/chat uses plan permission mode", async () => {
    app = createServer({
      mechaId: TEST_ID,
      skipMcp: true,
      skipAuth: true,
      agent: { workingDirectory: "/tmp", permissionMode: "plan" as const },
    });

    mockQuery.mockReturnValue(
      (async function* () {
        yield { type: "other" };
      })(),
    );

    await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { message: "test" },
    });

    const args = mockQuery.mock.calls[0][0];
    expect(args.options.permissionMode).toBe("plan");
  });

  it("POST /api/chat uses full-auto (acceptEdits) permission mode", async () => {
    app = createServer({
      mechaId: TEST_ID,
      skipMcp: true,
      skipAuth: true,
      agent: { workingDirectory: "/tmp", permissionMode: "full-auto" as const },
    });

    mockQuery.mockReturnValue(
      (async function* () {
        yield { type: "other" };
      })(),
    );

    await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { message: "test" },
    });

    const args = mockQuery.mock.calls[0][0];
    expect(args.options.permissionMode).toBe("acceptEdits");
  });
});
