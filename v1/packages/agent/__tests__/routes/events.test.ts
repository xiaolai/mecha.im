import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import { registerEventRoutes } from "../../src/routes/events.js";
import type { ProcessManager } from "@mecha/process";

describe("event routes", () => {
  it("subscribes to pm.onEvent when /events is called", async () => {
    let eventHandler: ((event: unknown) => void) | null = null;
    const unsubscribe = vi.fn();
    const pm = {
      onEvent: vi.fn((handler: (event: unknown) => void) => {
        eventHandler = handler;
        return unsubscribe;
      }),
    } as unknown as ProcessManager;

    const app = Fastify();
    registerEventRoutes(app, pm);

    // Use a raw HTTP connection to test SSE — inject() blocks on open streams
    await app.listen({ port: 0 });
    const address = app.server.address() as { port: number };

    const controller = new AbortController();
    const fetchPromise = fetch(`http://127.0.0.1:${address.port}/events`, {
      signal: controller.signal,
    });

    // Wait for the handler to be registered
    await vi.waitFor(() => { expect(pm.onEvent).toHaveBeenCalled(); });
    expect(eventHandler).not.toBeNull();

    // Abort to close the connection
    controller.abort();
    await fetchPromise.catch(() => {});

    await app.close();
  });
});
