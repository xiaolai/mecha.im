import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock all external dependencies before importing server module
const mockListChannels = vi.fn().mockReturnValue([]);
const mockClose = vi.fn();

vi.mock("../../src/db/store.js", () => {
  return {
    ChannelStore: class MockChannelStore {
      listChannels = mockListChannels;
      close = mockClose;
      getLink = vi.fn();
      updateSessionId = vi.fn();
    },
  };
});

const mockAdapterStart = vi.fn().mockResolvedValue(undefined);
const mockAdapterStop = vi.fn().mockResolvedValue(undefined);

vi.mock("../../src/adapters/telegram.js", () => ({
  TelegramAdapter: vi.fn().mockImplementation(function(this: any, id: string) {
    this.channelId = id;
    this.start = mockAdapterStart;
    this.stop = mockAdapterStop;
    this.sendText = vi.fn().mockResolvedValue(undefined);
  }),
}));

vi.mock("@mecha/process", () => ({
  createProcessManager: vi.fn().mockReturnValue({}),
}));

import { createGatewayServer } from "../../src/gateway/server.js";
import { TelegramAdapter } from "../../src/adapters/telegram.js";

describe("createGatewayServer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListChannels.mockReturnValue([]);
  });

  it("creates a server with /healthz endpoint", async () => {
    const server = await createGatewayServer({ dbPath: ":memory:" });
    const res = await server.app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({ status: "ok" });
    await server.stop();
  });

  it("starts and stops cleanly with no channels", async () => {
    const server = await createGatewayServer({ dbPath: ":memory:", port: 0 });
    await server.start();
    await server.stop();
    expect(mockClose).toHaveBeenCalled();
  });

  it("starts telegram adapters for enabled channels", async () => {
    mockListChannels.mockReturnValue([
      { id: "ch-1", type: "telegram", config: JSON.stringify({ botToken: "tok" }), enabled: 1 },
    ]);

    const server = await createGatewayServer({ dbPath: ":memory:", port: 0 });
    await server.start();

    expect(TelegramAdapter).toHaveBeenCalledWith("ch-1", "tok");
    expect(mockAdapterStart).toHaveBeenCalled();

    await server.stop();
  });

  it("skips disabled channels", async () => {
    mockListChannels.mockReturnValue([
      { id: "ch-1", type: "telegram", config: JSON.stringify({ botToken: "tok" }), enabled: 0 },
    ]);

    const server = await createGatewayServer({ dbPath: ":memory:", port: 0 });
    await server.start();

    expect(TelegramAdapter).not.toHaveBeenCalled();

    await server.stop();
  });

  it("skips channels with invalid config JSON", async () => {
    mockListChannels.mockReturnValue([
      { id: "ch-bad", type: "telegram", config: "NOT-JSON", enabled: 1 },
    ]);

    const server = await createGatewayServer({ dbPath: ":memory:", port: 0 });
    await server.start();

    expect(TelegramAdapter).not.toHaveBeenCalled();

    await server.stop();
  });

  it("skips channels with missing botToken in config", async () => {
    mockListChannels.mockReturnValue([
      { id: "ch-empty", type: "telegram", config: JSON.stringify({}), enabled: 1 },
    ]);

    const server = await createGatewayServer({ dbPath: ":memory:", port: 0 });
    await server.start();

    expect(TelegramAdapter).not.toHaveBeenCalled();

    await server.stop();
  });
});
