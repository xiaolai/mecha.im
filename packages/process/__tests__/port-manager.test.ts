import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { checkPort, allocatePort } from "../src/port-manager.js";
import type { MechaProcessInfo } from "../src/types.js";
import type { MechaId } from "@mecha/core";
import { createServer } from "node:net";

function makeInfo(port: number): MechaProcessInfo {
  return {
    id: `mx-test-${port}` as MechaId,
    pid: 1,
    port,
    projectPath: "/tmp",
    state: "running",
    authToken: "t",
    env: {},
    createdAt: "",
    startFingerprint: "1:0",
  };
}

describe("checkPort", () => {
  it("returns true for an available port", async () => {
    // Use a random high port that's very unlikely to be in use
    const result = await checkPort(19876);
    expect(result).toBe(true);
  });

  it("returns false for a port that is in use", async () => {
    // Bind to a port first
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(19877, "127.0.0.1", resolve));
    try {
      const result = await checkPort(19877);
      expect(result).toBe(false);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe("allocatePort", () => {
  it("returns preferred port when available", async () => {
    const port = await allocatePort(7700, 7799, [], 19878);
    expect(port).toBe(19878);
  });

  it("throws when preferred port is out of valid range", async () => {
    await expect(allocatePort(7700, 7799, [], 500)).rejects.toThrow("out of valid range");
  });

  it("throws when preferred port is in use", async () => {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(19879, "127.0.0.1", resolve));
    try {
      await expect(allocatePort(7700, 7799, [], 19879)).rejects.toThrow("not available");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("skips ports already allocated to live processes", async () => {
    // Allocate from a narrow range where first port is taken by a live process
    const allocated = [makeInfo(19880)];
    // Port 19880 is allocated to a live process but not actually bound,
    // so it should be skipped
    const port = await allocatePort(19880, 19882, allocated);
    expect(port).not.toBe(19880);
    expect(port).toBeGreaterThanOrEqual(19881);
    expect(port).toBeLessThanOrEqual(19882);
  });

  it("allocates first available port from range", async () => {
    const port = await allocatePort(19883, 19885, []);
    expect(port).toBeGreaterThanOrEqual(19883);
    expect(port).toBeLessThanOrEqual(19885);
  });

  it("throws when no ports available in range", async () => {
    // Bind all ports in a tiny range
    const servers: ReturnType<typeof createServer>[] = [];
    for (let p = 19886; p <= 19887; p++) {
      const s = createServer();
      await new Promise<void>((resolve) => s.listen(p, "127.0.0.1", resolve));
      servers.push(s);
    }
    try {
      await expect(allocatePort(19886, 19887, [])).rejects.toThrow("No available ports");
    } finally {
      for (const s of servers) {
        await new Promise<void>((resolve) => s.close(() => resolve()));
      }
    }
  });
});
