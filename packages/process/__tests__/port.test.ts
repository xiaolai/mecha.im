import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server } from "node:net";
import { checkPort, allocatePort, claimPort } from "../src/port.js";
import type { PortClaim } from "../src/port.js";

/** Listen on an ephemeral port and return the server + assigned port. */
function listenEphemeral(): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolve({ server, port: addr.port });
    });
  });
}

/** Close a server and wait for completion. */
function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    if (server.listening) {
      server.close(() => resolve());
    } else {
      resolve();
    }
  });
}

/** Run a callback with a PortClaim, guaranteeing release in finally. */
async function withClaim(claim: PortClaim, fn: (claim: PortClaim) => Promise<void>): Promise<void> {
  try {
    await fn(claim);
  } finally {
    await claim.release();
  }
}

// Use high ephemeral range (49200+) to minimize collision with system services
const TEST_PORT_BASE = 49200;

describe("checkPort", () => {
  let server: Server;

  afterEach(() => closeServer(server));

  it("returns true for a free port", async () => {
    const { server: s, port } = await listenEphemeral();
    await closeServer(s);
    server = s;
    const result = await checkPort(port);
    expect(result).toBe(true);
  });

  it("returns false for an occupied port", async () => {
    const { server: s, port } = await listenEphemeral();
    server = s;
    const result = await checkPort(port);
    expect(result).toBe(false);
  });
});

describe("claimPort", () => {
  it("claims a free port and returns a release function", async () => {
    const { server, port } = await listenEphemeral();
    await closeServer(server);

    const release = await claimPort(port);
    try {
      expect(release).toBeTypeOf("function");
      const free = await checkPort(port);
      expect(free).toBe(false);
    } finally {
      await release!();
    }
    const freeAfter = await checkPort(port);
    expect(freeAfter).toBe(true);
  });

  it("returns undefined for an occupied port", async () => {
    const { server, port } = await listenEphemeral();
    try {
      const release = await claimPort(port);
      expect(release).toBeUndefined();
    } finally {
      await closeServer(server);
    }
  });

  it("release is idempotent", async () => {
    const { server, port } = await listenEphemeral();
    await closeServer(server);

    const release = await claimPort(port);
    expect(release).toBeTypeOf("function");
    await release!();
    await release!();
  });
});

describe("allocatePort", () => {
  it("returns a PortClaim with port and release", async () => {
    const claim = await allocatePort(TEST_PORT_BASE, TEST_PORT_BASE + 10);
    await withClaim(claim, async (c) => {
      expect(c.port).toBeGreaterThanOrEqual(TEST_PORT_BASE);
      expect(c.port).toBeLessThanOrEqual(TEST_PORT_BASE + 10);
      expect(c.release).toBeTypeOf("function");
    });
  });

  it("skips excluded ports", async () => {
    const exclude = new Set([TEST_PORT_BASE, TEST_PORT_BASE + 1, TEST_PORT_BASE + 2]);
    const claim = await allocatePort(TEST_PORT_BASE, TEST_PORT_BASE + 10, exclude);
    await withClaim(claim, async (c) => {
      expect(c.port).toBeGreaterThanOrEqual(TEST_PORT_BASE + 3);
    });
  });

  it("skips occupied ports", async () => {
    const occupyRelease = await claimPort(TEST_PORT_BASE + 20);
    try {
      const claim = await allocatePort(TEST_PORT_BASE + 20, TEST_PORT_BASE + 25);
      await withClaim(claim, async (c) => {
        expect(c.port).not.toBe(TEST_PORT_BASE + 20);
        expect(c.port).toBeGreaterThan(TEST_PORT_BASE + 20);
      });
    } finally {
      await occupyRelease?.();
    }
  });

  it("prevents concurrent allocations from claiming same port", async () => {
    const [claim1, claim2] = await Promise.all([
      allocatePort(TEST_PORT_BASE + 30, TEST_PORT_BASE + 35),
      allocatePort(TEST_PORT_BASE + 30, TEST_PORT_BASE + 35),
    ]);
    try {
      expect(claim1.port).not.toBe(claim2.port);
    } finally {
      await claim1.release();
      await claim2.release();
    }
  });

  it("throws PortRangeExhaustedError when range exhausted", async () => {
    const exclude = new Set([TEST_PORT_BASE + 99, TEST_PORT_BASE + 100]);
    await expect(
      allocatePort(TEST_PORT_BASE + 99, TEST_PORT_BASE + 100, exclude),
    ).rejects.toThrow(`No available port in range ${TEST_PORT_BASE + 99}-${TEST_PORT_BASE + 100}`);
  });
});
