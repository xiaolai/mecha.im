import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createServer, type Server } from "node:net";
import { checkPort, allocatePort } from "../src/port.js";

describe("checkPort", () => {
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

  it("returns true for a free port", async () => {
    const result = await checkPort(19876);
    expect(result).toBe(true);
  });

  it("returns false for an occupied port", async () => {
    server = createServer();
    const port = await new Promise<number>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        resolve((addr as { port: number }).port);
      });
    });
    const result = await checkPort(port);
    expect(result).toBe(false);
  });
});

describe("allocatePort", () => {
  it("returns the first available port in range", async () => {
    // Use a high port range unlikely to be occupied
    const port = await allocatePort(19800, 19810);
    expect(port).toBeGreaterThanOrEqual(19800);
    expect(port).toBeLessThanOrEqual(19810);
  });

  it("skips excluded ports", async () => {
    const exclude = new Set([19800, 19801, 19802]);
    const port = await allocatePort(19800, 19810, exclude);
    expect(port).toBeGreaterThanOrEqual(19803);
  });

  it("skips occupied ports", async () => {
    // Occupy a port, then allocate — should skip it
    const server = createServer();
    const occupiedPort = await new Promise<number>((resolve) => {
      server.listen(19820, "127.0.0.1", () => {
        resolve(19820);
      });
    });

    try {
      const port = await allocatePort(19820, 19825);
      expect(port).not.toBe(occupiedPort);
      expect(port).toBeGreaterThan(19820);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("throws PortRangeExhaustedError when range exhausted", async () => {
    // Exclude all ports in a tiny range
    const exclude = new Set([19900, 19901]);
    await expect(
      allocatePort(19900, 19901, exclude),
    ).rejects.toThrow("No available port in range 19900-19901");
  });
});
