import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { waitForHealthy } from "../src/health.js";

describe("waitForHealthy", () => {
  let server: Server;

  afterEach(() => {
    return new Promise<void>((resolve) => {
      if (server?.listening) {
        server.close(() => resolve());
      } else {
        resolve();
      }
    });
  });

  it("resolves when healthz returns 200", async () => {
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      if (req.url === "/healthz") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    const port = await new Promise<number>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        resolve((addr as { port: number }).port);
      });
    });

    await expect(
      waitForHealthy(port, "test-token", 5000, "test-bot"),
    ).resolves.toBeUndefined();
  });

  it("retries and succeeds after initial failures", async () => {
    let requestCount = 0;
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      requestCount++;
      if (requestCount <= 2) {
        res.writeHead(503);
        res.end();
      } else {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
      }
    });

    const port = await new Promise<number>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        resolve((addr as { port: number }).port);
      });
    });

    await expect(
      waitForHealthy(port, "test-token", 5000, "test-bot"),
    ).resolves.toBeUndefined();
    expect(requestCount).toBeGreaterThanOrEqual(3);
  });

  it("throws ProcessHealthTimeoutError after timeout", async () => {
    // No server listening on this port — connection refused every time
    await expect(
      waitForHealthy(19999, "test-token", 500, "my-bot"),
    ).rejects.toThrow('bot "my-bot" failed health check');
  });

  it("uses exponential backoff", async () => {
    const timestamps: number[] = [];
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      timestamps.push(Date.now());
      if (timestamps.length < 4) {
        res.writeHead(503);
        res.end();
      } else {
        res.writeHead(200);
        res.end(JSON.stringify({ status: "ok" }));
      }
    });

    const port = await new Promise<number>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        resolve((addr as { port: number }).port);
      });
    });

    await waitForHealthy(port, "test-token", 5000, "backoff-test");

    // Verify delays increase (backoff)
    if (timestamps.length >= 3) {
      const gap1 = timestamps[1]! - timestamps[0]!;
      const gap2 = timestamps[2]! - timestamps[1]!;
      // Second gap should be >= first gap (exponential backoff)
      expect(gap2).toBeGreaterThanOrEqual(gap1 * 0.8); // allow some jitter
    }
  });
});
