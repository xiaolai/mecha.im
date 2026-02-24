import { describe, it, expect, vi } from "vitest";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { runtimeFetch } from "../src/helpers.js";
import { CasaNotFoundError, CasaNotRunningError, type CasaName } from "@mecha/core";
import type { ProcessManager } from "@mecha/process";

function createMockPM(overrides: Partial<ProcessManager> = {}): ProcessManager {
  return {
    spawn: vi.fn(),
    get: vi.fn().mockReturnValue(undefined),
    list: vi.fn().mockReturnValue([]),
    stop: vi.fn(),
    kill: vi.fn(),
    logs: vi.fn(),
    getPortAndToken: vi.fn().mockReturnValue(undefined),
    onEvent: vi.fn().mockReturnValue(() => {}),
    ...overrides,
  } as ProcessManager;
}

const CASA_NAME = "test" as CasaName;
const TOKEN = "test-token-abc";

function startJsonServer(): Promise<{ server: ReturnType<typeof createServer>; port: number }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
      req.on("end", () => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          method: req.method,
          url: req.url,
          authorization: req.headers.authorization,
          contentType: req.headers["content-type"],
          body: body || null,
        }));
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      resolve({ server, port });
    });
  });
}

function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

describe("runtimeFetch", () => {
  it("makes GET request with auth header", async () => {
    const { server, port } = await startJsonServer();
    try {
      const pm = createMockPM({
        getPortAndToken: vi.fn().mockReturnValue({ port, token: TOKEN }),
      });

      const result = await runtimeFetch(pm, CASA_NAME, "/healthz");
      expect(result.status).toBe(200);
      const body = result.body as { method: string; authorization: string; url: string };
      expect(body.method).toBe("GET");
      expect(body.url).toBe("/healthz");
      expect(body.authorization).toBe(`Bearer ${TOKEN}`);
    } finally {
      await closeServer(server);
    }
  });

  it("makes POST request with JSON body", async () => {
    const { server, port } = await startJsonServer();
    try {
      const pm = createMockPM({
        getPortAndToken: vi.fn().mockReturnValue({ port, token: TOKEN }),
      });

      const result = await runtimeFetch(pm, CASA_NAME, "/api/sessions", {
        method: "POST",
        body: { title: "Test" },
      });
      expect(result.status).toBe(200);
      const body = result.body as { method: string; body: string; contentType: string };
      expect(body.method).toBe("POST");
      expect(body.contentType).toBe("application/json");
      expect(JSON.parse(body.body)).toEqual({ title: "Test" });
    } finally {
      await closeServer(server);
    }
  });

  it("passes custom headers", async () => {
    const { server, port } = await startJsonServer();
    try {
      const pm = createMockPM({
        getPortAndToken: vi.fn().mockReturnValue({ port, token: TOKEN }),
      });

      const result = await runtimeFetch(pm, CASA_NAME, "/test", {
        headers: { "x-custom": "value" },
      });
      expect(result.status).toBe(200);
    } finally {
      await closeServer(server);
    }
  });

  it("throws CasaNotFoundError when CASA does not exist", async () => {
    const pm = createMockPM();
    await expect(runtimeFetch(pm, CASA_NAME, "/test")).rejects.toThrow(CasaNotFoundError);
  });

  it("throws CasaNotRunningError when CASA exists but is stopped", async () => {
    const pm = createMockPM({
      get: vi.fn().mockReturnValue({ name: CASA_NAME, state: "stopped" }),
    });
    await expect(runtimeFetch(pm, CASA_NAME, "/test")).rejects.toThrow(CasaNotRunningError);
  });

  it("handles text response", async () => {
    const textServer = createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("plain text response");
    });
    await new Promise<void>((resolve) => textServer.listen(0, "127.0.0.1", resolve));
    const textPort = (textServer.address() as AddressInfo).port;

    try {
      const pm = createMockPM({
        getPortAndToken: vi.fn().mockReturnValue({ port: textPort, token: TOKEN }),
      });

      const result = await runtimeFetch(pm, CASA_NAME, "/test");
      expect(result.status).toBe(200);
      expect(result.body).toBe("plain text response");
    } finally {
      await closeServer(textServer);
    }
  });

  it("handles response without content-type header", async () => {
    const bareServer = createServer((_req, res) => {
      res.writeHead(200);
      res.end("bare response");
    });
    await new Promise<void>((resolve) => bareServer.listen(0, "127.0.0.1", resolve));
    const barePort = (bareServer.address() as AddressInfo).port;

    try {
      const pm = createMockPM({
        getPortAndToken: vi.fn().mockReturnValue({ port: barePort, token: TOKEN }),
      });

      const result = await runtimeFetch(pm, CASA_NAME, "/test");
      expect(result.status).toBe(200);
      expect(result.body).toBe("bare response");
    } finally {
      await closeServer(bareServer);
    }
  });

  it("returns raw Response object", async () => {
    const { server, port } = await startJsonServer();
    try {
      const pm = createMockPM({
        getPortAndToken: vi.fn().mockReturnValue({ port, token: TOKEN }),
      });

      const result = await runtimeFetch(pm, CASA_NAME, "/test");
      expect(result.raw).toBeInstanceOf(Response);
    } finally {
      await closeServer(server);
    }
  });
});
