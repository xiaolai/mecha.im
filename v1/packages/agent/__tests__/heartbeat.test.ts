import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const { startHeartbeat } = await import("../src/heartbeat.js");

describe("heartbeat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("pings nodes on start and calls onUpdate", async () => {
    const nodes = [{ name: "a", host: "1.2.3.4:7660", key: "k1" }];
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ mechaCount: 3 }),
    });

    const onUpdate = vi.fn();
    const hb = startHeartbeat({ nodes: () => nodes, intervalMs: 5000, onUpdate });

    // Allow initial tick to settle
    await vi.advanceTimersByTimeAsync(0);

    expect(onUpdate).toHaveBeenCalledTimes(1);
    const health = onUpdate.mock.calls[0]![0];
    expect(health).toHaveLength(1);
    expect(health[0].name).toBe("a");
    expect(health[0].status).toBe("online");
    expect(health[0].mechaCount).toBe(3);
    expect(health[0].latencyMs).toBeGreaterThanOrEqual(0);
    expect(health[0].lastSeen).toBeTruthy();

    hb.stop();
  });

  it("marks nodes as offline when fetch fails", async () => {
    const nodes = [{ name: "b", host: "5.6.7.8:7660", key: "k2" }];
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));

    const onUpdate = vi.fn();
    const hb = startHeartbeat({ nodes: () => nodes, intervalMs: 5000, onUpdate });

    await vi.advanceTimersByTimeAsync(0);

    expect(onUpdate).toHaveBeenCalledTimes(1);
    const health = onUpdate.mock.calls[0]![0];
    expect(health[0].status).toBe("offline");
    expect(health[0].latencyMs).toBeNull();
    expect(health[0].lastSeen).toBeNull();
    expect(health[0].mechaCount).toBeNull();

    hb.stop();
  });

  it("marks nodes as offline when HTTP response is not ok", async () => {
    const nodes = [{ name: "c", host: "9.8.7.6:7660", key: "k3" }];
    mockFetch.mockResolvedValue({ ok: false });

    const onUpdate = vi.fn();
    const hb = startHeartbeat({ nodes: () => nodes, intervalMs: 5000, onUpdate });

    await vi.advanceTimersByTimeAsync(0);

    const health = onUpdate.mock.calls[0]![0];
    expect(health[0].status).toBe("offline");

    hb.stop();
  });

  it("handles empty node list", async () => {
    const onUpdate = vi.fn();
    const hb = startHeartbeat({ nodes: () => [], intervalMs: 5000, onUpdate });

    await vi.advanceTimersByTimeAsync(0);

    expect(onUpdate).toHaveBeenCalledWith([]);

    hb.stop();
  });

  it("runs on interval and can be stopped", async () => {
    const nodes = [{ name: "d", host: "1.1.1.1:7660", key: "k4" }];
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ mechaCount: 0 }),
    });

    const onUpdate = vi.fn();
    const hb = startHeartbeat({ nodes: () => nodes, intervalMs: 1000, onUpdate });

    await vi.advanceTimersByTimeAsync(0);
    expect(onUpdate).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(onUpdate).toHaveBeenCalledTimes(2);

    hb.stop();

    await vi.advanceTimersByTimeAsync(1000);
    expect(onUpdate).toHaveBeenCalledTimes(2); // No more calls after stop
  });

  it("handles mechaCount missing from healthz response", async () => {
    const nodes = [{ name: "e", host: "2.2.2.2:7660", key: "k5" }];
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ status: "ok" }),
    });

    const onUpdate = vi.fn();
    const hb = startHeartbeat({ nodes: () => nodes, intervalMs: 5000, onUpdate });

    await vi.advanceTimersByTimeAsync(0);

    const health = onUpdate.mock.calls[0]![0];
    expect(health[0].mechaCount).toBeNull();

    hb.stop();
  });

  it("prepends http:// when host has no protocol", async () => {
    const nodes = [{ name: "f", host: "3.3.3.3:7660", key: "k6" }];
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ mechaCount: 1 }),
    });

    const onUpdate = vi.fn();
    const hb = startHeartbeat({ nodes: () => nodes, intervalMs: 5000, onUpdate });
    await vi.advanceTimersByTimeAsync(0);

    expect(mockFetch).toHaveBeenCalledWith(
      "http://3.3.3.3:7660/healthz",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer k6" }) }),
    );

    hb.stop();
  });

  it("uses host as-is when it has a protocol", async () => {
    const nodes = [{ name: "g", host: "https://secure.host:7660", key: "k7" }];
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ mechaCount: 0 }),
    });

    const onUpdate = vi.fn();
    const hb = startHeartbeat({ nodes: () => nodes, intervalMs: 5000, onUpdate });
    await vi.advanceTimersByTimeAsync(0);

    expect(mockFetch).toHaveBeenCalledWith(
      "https://secure.host:7660/healthz",
      expect.objectContaining({}),
    );

    hb.stop();
  });
});
