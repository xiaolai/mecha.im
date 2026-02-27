import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const originalMaxListeners = process.getMaxListeners();
process.setMaxListeners(50);

let transportInstances: Array<{
  sessionId: string;
  handleRequest: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  onclose?: () => void;
}>;

vi.mock("@modelcontextprotocol/sdk/server/streamableHttp.js", () => {
  class MockTransport {
    sessionId: string | undefined;
    onclose: (() => void) | undefined;
    handleRequest = vi.fn().mockResolvedValue(undefined);
    close = vi.fn().mockResolvedValue(undefined);
    constructor(opts?: { sessionIdGenerator?: () => string }) {
      this.sessionId = opts?.sessionIdGenerator?.() ?? undefined;
      transportInstances.push(this as unknown as (typeof transportInstances)[0]);
    }
  }
  return { StreamableHTTPServerTransport: MockTransport };
});

let uuidCounter = 0;
vi.mock("node:crypto", async (importOriginal) => {
  const orig = await importOriginal<typeof import("node:crypto")>();
  return {
    ...orig,
    randomUUID: () => `session-${++uuidCounter}`,
  };
});

let capturedHandler: ((req: IncomingMessage, res: ServerResponse) => void) | undefined;

vi.mock("node:http", () => ({
  createServer: (handler: (req: IncomingMessage, res: ServerResponse) => void) => {
    capturedHandler = handler;
    return {
      once: () => {},
      removeListener: () => {},
      listen: (_port: number, _host: string, cb: () => void) => cb(),
      close: (cb: () => void) => cb(),
    };
  },
}));

import { runHttp } from "../src/http-transport.js";

let serverInstances: Array<{ connect: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }>;

function createMockServer(): McpServer {
  const s = {
    connect: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
  serverInstances.push(s);
  return s as unknown as McpServer;
}

function makeReq(overrides: Partial<IncomingMessage> & { url?: string; method?: string; headers?: Record<string, string | string[]> }): IncomingMessage {
  return {
    url: "/mcp",
    method: "POST",
    headers: { host: "localhost:7680" },
    ...overrides,
  } as unknown as IncomingMessage;
}

function makeRes(): ServerResponse & { _status: number; _body: string; headersSent: boolean } {
  const res = {
    _status: 0,
    _body: "",
    headersSent: false,
    writeHead(status: number) {
      res._status = status;
      res.headersSent = true;
      return res;
    },
    end(body?: string) {
      if (body) res._body = body;
    },
  };
  return res as unknown as ServerResponse & { _status: number; _body: string; headersSent: boolean };
}

afterAll(() => {
  process.setMaxListeners(originalMaxListeners);
});

describe("runHttp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    transportInstances = [];
    serverInstances = [];
    uuidCounter = 0;
    capturedHandler = undefined;
  });

  async function setup(): Promise<(req: IncomingMessage, res: ServerResponse) => Promise<void>> {
    runHttp(createMockServer, { port: 7680, host: "127.0.0.1" });
    await new Promise((r) => setTimeout(r, 0));
    expect(capturedHandler).toBeDefined();
    return capturedHandler! as (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  }

  it("returns 404 for unknown paths", async () => {
    const handler = await setup();
    const res = makeRes();
    await handler(makeReq({ url: "/unknown" }), res);
    expect(res._status).toBe(404);
    expect(JSON.parse(res._body)).toEqual({ error: "Not found" });
  });

  it("returns 405 for unsupported methods", async () => {
    const handler = await setup();
    const res = makeRes();
    await handler(makeReq({ method: "PUT" }), res);
    expect(res._status).toBe(405);
  });

  it("creates a new session on POST without mcp-session-id", async () => {
    const handler = await setup();
    const res = makeRes();
    await handler(makeReq({ method: "POST", headers: { host: "localhost:7680" } }), res);
    expect(transportInstances).toHaveLength(1);
    expect(transportInstances[0].sessionId).toBe("session-1");
    expect(transportInstances[0].handleRequest).toHaveBeenCalledOnce();
    expect(serverInstances[0].connect).toHaveBeenCalledOnce();
  });

  it("routes to existing session on POST with mcp-session-id", async () => {
    const handler = await setup();

    await handler(makeReq({ method: "POST", headers: { host: "localhost:7680" } }), makeRes());

    const res = makeRes();
    await handler(
      makeReq({ method: "POST", headers: { host: "localhost:7680", "mcp-session-id": "session-1" } }),
      res,
    );
    expect(transportInstances[0].handleRequest).toHaveBeenCalledTimes(2);
  });

  it("returns 404 for unknown session ID", async () => {
    const handler = await setup();
    const res = makeRes();
    await handler(
      makeReq({ method: "POST", headers: { host: "localhost:7680", "mcp-session-id": "nonexistent" } }),
      res,
    );
    expect(res._status).toBe(404);
    expect(JSON.parse(res._body)).toEqual({ error: "Session not found" });
  });

  it("returns 400 for GET without mcp-session-id", async () => {
    const handler = await setup();
    const res = makeRes();
    await handler(makeReq({ method: "GET", headers: { host: "localhost:7680" } }), res);
    expect(res._status).toBe(400);
    expect(JSON.parse(res._body)).toEqual({ error: "Missing mcp-session-id header" });
  });

  it("returns 400 for duplicate mcp-session-id headers (string[])", async () => {
    const handler = await setup();
    const res = makeRes();
    await handler(
      makeReq({
        method: "POST",
        headers: { host: "localhost:7680", "mcp-session-id": ["a", "b"] as unknown as string },
      }),
      res,
    );
    expect(res._status).toBe(400);
    expect(JSON.parse(res._body)).toEqual({ error: "Invalid mcp-session-id header" });
  });

  it("handles GET with valid session ID", async () => {
    const handler = await setup();

    await handler(makeReq({ method: "POST", headers: { host: "localhost:7680" } }), makeRes());

    const res = makeRes();
    await handler(
      makeReq({ method: "GET", headers: { host: "localhost:7680", "mcp-session-id": "session-1" } }),
      res,
    );
    expect(transportInstances[0].handleRequest).toHaveBeenCalledTimes(2);
  });

  it("handles DELETE — closes transport and server, removes session", async () => {
    const handler = await setup();

    await handler(makeReq({ method: "POST", headers: { host: "localhost:7680" } }), makeRes());

    const res = makeRes();
    await handler(
      makeReq({ method: "DELETE", headers: { host: "localhost:7680", "mcp-session-id": "session-1" } }),
      res,
    );
    expect(res._status).toBe(200);
    expect(JSON.parse(res._body)).toEqual({ ok: true });
    expect(transportInstances[0].close).toHaveBeenCalledOnce();
    expect(serverInstances[0].close).toHaveBeenCalledOnce();

    // Session removed — subsequent requests 404
    const res2 = makeRes();
    await handler(
      makeReq({ method: "POST", headers: { host: "localhost:7680", "mcp-session-id": "session-1" } }),
      res2,
    );
    expect(res2._status).toBe(404);
  });

  it("supports multiple concurrent sessions independently", async () => {
    const handler = await setup();

    await handler(makeReq({ method: "POST", headers: { host: "localhost:7680" } }), makeRes());
    await handler(makeReq({ method: "POST", headers: { host: "localhost:7680" } }), makeRes());
    expect(transportInstances).toHaveLength(2);
    expect(transportInstances[0].sessionId).toBe("session-1");
    expect(transportInstances[1].sessionId).toBe("session-2");

    await handler(
      makeReq({ method: "POST", headers: { host: "localhost:7680", "mcp-session-id": "session-1" } }),
      makeRes(),
    );
    await handler(
      makeReq({ method: "POST", headers: { host: "localhost:7680", "mcp-session-id": "session-2" } }),
      makeRes(),
    );
    expect(transportInstances[0].handleRequest).toHaveBeenCalledTimes(2);
    expect(transportInstances[1].handleRequest).toHaveBeenCalledTimes(2);
  });

  it("cleans up session when transport onclose fires", async () => {
    const handler = await setup();

    await handler(makeReq({ method: "POST", headers: { host: "localhost:7680" } }), makeRes());

    transportInstances[0].onclose?.();

    const res = makeRes();
    await handler(
      makeReq({ method: "POST", headers: { host: "localhost:7680", "mcp-session-id": "session-1" } }),
      res,
    );
    expect(res._status).toBe(404);
  });

  it("returns 503 when session cap is reached", async () => {
    const handler = await setup();

    for (let i = 0; i < 64; i++) {
      await handler(makeReq({ method: "POST", headers: { host: "localhost:7680" } }), makeRes());
    }
    expect(transportInstances).toHaveLength(64);

    const res = makeRes();
    await handler(makeReq({ method: "POST", headers: { host: "localhost:7680" } }), res);
    expect(res._status).toBe(503);
    expect(JSON.parse(res._body)).toEqual({ error: "Too many sessions" });
  });

  it("cleans up session state when handleRequest throws on new session", async () => {
    const handler = await setup();

    // Make the next transport's handleRequest throw
    const origPush = transportInstances.push.bind(transportInstances);
    let interceptNext = true;
    const origInstances = transportInstances;
    vi.spyOn(origInstances, "push").mockImplementation((...args) => {
      const result = origPush(...args);
      if (interceptNext) {
        interceptNext = false;
        const t = origInstances[origInstances.length - 1];
        t.handleRequest.mockRejectedValueOnce(new Error("transport error"));
      }
      return result;
    });

    const res = makeRes();
    await handler(makeReq({ method: "POST", headers: { host: "localhost:7680" } }), res);

    // Session should have been cleaned up
    expect(transportInstances[0].close).toHaveBeenCalledOnce();
    expect(serverInstances[0].close).toHaveBeenCalledOnce();
    expect(res._status).toBe(500);

    vi.restoreAllMocks();
  });

  it("catches errors on existing-session handleRequest", async () => {
    const handler = await setup();

    await handler(makeReq({ method: "POST", headers: { host: "localhost:7680" } }), makeRes());

    // Make handleRequest throw on the next call
    transportInstances[0].handleRequest.mockRejectedValueOnce(new Error("boom"));

    const res = makeRes();
    await handler(
      makeReq({ method: "POST", headers: { host: "localhost:7680", "mcp-session-id": "session-1" } }),
      res,
    );
    expect(res._status).toBe(500);
    expect(JSON.parse(res._body)).toEqual({ error: "Internal server error" });
  });
});
