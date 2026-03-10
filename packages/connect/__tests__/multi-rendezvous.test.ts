import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMultiRendezvousClient } from "../src/multi-rendezvous.js";

// Mock createRendezvousClient
vi.mock("../src/rendezvous.js", () => ({
  createRendezvousClient: vi.fn(),
}));

import { createRendezvousClient } from "../src/rendezvous.js";
import type { RendezvousClient, PeerInfo, SignalData } from "../src/types.js";

const mockCreate = vi.mocked(createRendezvousClient);

function makeMockClient(opts?: { failConnect?: boolean }): RendezvousClient & { _fireDisconnect: () => void } {
  const signalHandlers: Array<(from: string, data: SignalData) => void> = [];
  const inviteHandlers: Array<(peer: string, pk: string, npk: string, fp: string) => void> = [];
  const disconnectHandlers: Array<() => void> = [];
  return {
    connect: opts?.failConnect ? vi.fn().mockRejectedValue(new Error("connection refused")) : vi.fn().mockResolvedValue(undefined),
    register: vi.fn().mockResolvedValue(undefined),
    unregister: vi.fn().mockResolvedValue(undefined),
    lookup: vi.fn().mockResolvedValue(undefined),
    signal: vi.fn().mockResolvedValue(undefined),
    requestRelay: vi.fn().mockResolvedValue("relay-token"),
    onSignal: vi.fn((handler) => { signalHandlers.push(handler); }),
    onInviteAccepted: vi.fn((handler) => { inviteHandlers.push(handler); }),
    onDisconnect: vi.fn((handler) => { disconnectHandlers.push(handler); }),
    close: vi.fn(),
    _fireDisconnect: () => { for (const h of disconnectHandlers) h(); },
  };
}

const signFn = vi.fn().mockReturnValue("sig");

describe("createMultiRendezvousClient", () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it("throws if no URLs provided", () => {
    expect(() => createMultiRendezvousClient({ urls: [], signFn })).toThrow("No rendezvous URLs provided");
  });

  it("connects to first URL that succeeds", async () => {
    const failClient = makeMockClient({ failConnect: true });
    const goodClient = makeMockClient();
    mockCreate.mockReturnValueOnce(failClient).mockReturnValueOnce(goodClient);

    const multi = createMultiRendezvousClient({ urls: ["ws://bad", "ws://good"], signFn });
    await multi.connect();

    // Should have tried to connect to both
    expect(failClient.connect).toHaveBeenCalled();
    expect(goodClient.connect).toHaveBeenCalled();
  });

  it("throws ConnectError when all URLs fail", async () => {
    const fail1 = makeMockClient({ failConnect: true });
    const fail2 = makeMockClient({ failConnect: true });
    mockCreate.mockReturnValueOnce(fail1).mockReturnValueOnce(fail2);

    const multi = createMultiRendezvousClient({ urls: ["ws://a", "ws://b"], signFn });
    await expect(multi.connect()).rejects.toThrow("All rendezvous servers unreachable");
  });

  it("delegates register/unregister/lookup/signal/requestRelay to active client", async () => {
    const client = makeMockClient();
    mockCreate.mockReturnValueOnce(client);

    const multi = createMultiRendezvousClient({ urls: ["ws://ok"], signFn });
    await multi.connect();

    const identity = { name: "alice", publicKey: "pk", noisePublicKey: "npk", fingerprint: "fp" };
    await multi.register(identity);
    expect(client.register).toHaveBeenCalledWith(identity);

    await multi.unregister();
    expect(client.unregister).toHaveBeenCalled();

    await multi.lookup("bob" as any);
    expect(client.lookup).toHaveBeenCalledWith("bob");

    await multi.signal("bob" as any, { type: "offer", candidates: [] });
    expect(client.signal).toHaveBeenCalled();

    const token = await multi.requestRelay("bob" as any);
    expect(token).toBe("relay-token");
  });

  it("throws when calling methods before connect", async () => {
    const multi = createMultiRendezvousClient({ urls: ["ws://ok"], signFn });
    await expect(multi.register({ name: "a", publicKey: "b", noisePublicKey: "c", fingerprint: "d" })).rejects.toThrow("Not connected");
  });

  it("registers onSignal and onInviteAccepted on active client", async () => {
    const client = makeMockClient();
    mockCreate.mockReturnValueOnce(client);

    const multi = createMultiRendezvousClient({ urls: ["ws://ok"], signFn });

    // Register handlers before connect
    const signalHandler = vi.fn();
    const inviteHandler = vi.fn();
    multi.onSignal(signalHandler);
    multi.onInviteAccepted(inviteHandler);

    await multi.connect();

    // Handlers should be wired to the active client
    expect(client.onSignal).toHaveBeenCalledWith(signalHandler);
    expect(client.onInviteAccepted).toHaveBeenCalledWith(inviteHandler);
  });

  it("registers onSignal on already-active client", async () => {
    const client = makeMockClient();
    mockCreate.mockReturnValueOnce(client);

    const multi = createMultiRendezvousClient({ urls: ["ws://ok"], signFn });
    await multi.connect();

    const handler = vi.fn();
    multi.onSignal(handler);
    expect(client.onSignal).toHaveBeenCalledWith(handler);
  });

  it("close() closes active client", async () => {
    const client = makeMockClient();
    mockCreate.mockReturnValueOnce(client);

    const multi = createMultiRendezvousClient({ urls: ["ws://ok"], signFn });
    await multi.connect();
    multi.close();

    expect(client.close).toHaveBeenCalled();
  });

  it("close() is safe when not connected", () => {
    const multi = createMultiRendezvousClient({ urls: ["ws://ok"], signFn });
    expect(() => multi.close()).not.toThrow();
  });

  it("wires onDisconnect on active client during connect", async () => {
    const client = makeMockClient();
    mockCreate.mockReturnValueOnce(client);

    const multi = createMultiRendezvousClient({ urls: ["ws://ok"], signFn });
    await multi.connect();

    expect(client.onDisconnect).toHaveBeenCalled();
  });

  it("fails over to next server on disconnect", async () => {
    const client1 = makeMockClient();
    const client2 = makeMockClient();
    mockCreate.mockReturnValueOnce(client1).mockReturnValueOnce(client2);

    const multi = createMultiRendezvousClient({ urls: ["ws://server1", "ws://server2"], signFn });
    await multi.connect();

    // Register identity so failover re-registers
    const identity = { name: "alice", publicKey: "pk", noisePublicKey: "npk", fingerprint: "fp" };
    await multi.register(identity);

    // Simulate disconnect from server1
    client1._fireDisconnect();

    // Allow async failover to complete (connect + re-register)
    await vi.waitFor(() => {
      expect(client2.connect).toHaveBeenCalled();
      expect(client2.register).toHaveBeenCalledWith(identity);
    });
  });

  it("notifies disconnect handlers when all servers exhausted", async () => {
    const client1 = makeMockClient();
    const failClient = makeMockClient({ failConnect: true });
    mockCreate.mockReturnValueOnce(client1).mockReturnValueOnce(failClient);

    const multi = createMultiRendezvousClient({ urls: ["ws://server1", "ws://server2"], signFn });
    await multi.connect();

    const disconnectHandler = vi.fn();
    multi.onDisconnect(disconnectHandler);

    // Simulate disconnect — server2 also fails
    client1._fireDisconnect();

    await vi.waitFor(() => {
      expect(disconnectHandler).toHaveBeenCalled();
    });
  });

  it("does not failover after explicit close()", async () => {
    const client1 = makeMockClient();
    const client2 = makeMockClient();
    mockCreate.mockReturnValueOnce(client1).mockReturnValueOnce(client2);

    const multi = createMultiRendezvousClient({ urls: ["ws://server1", "ws://server2"], signFn });
    await multi.connect();

    multi.close();
    client1._fireDisconnect();

    // Give time for any async failover (should not happen)
    await new Promise((r) => setTimeout(r, 50));
    expect(client2.connect).not.toHaveBeenCalled();
  });
});
