import { describe, it, expect, vi } from "vitest";
import { ProcessEventEmitter } from "../src/events.js";
import type { ProcessEvent } from "../src/events.js";
import type { CasaName } from "@mecha/core";

const name = "researcher" as CasaName;

describe("ProcessEventEmitter", () => {
  it("emits events to subscribers", () => {
    const emitter = new ProcessEventEmitter();
    const handler = vi.fn();
    emitter.subscribe(handler);

    const event: ProcessEvent = { type: "spawned", name, pid: 123, port: 7701 };
    emitter.emit(event);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(event);
  });

  it("supports multiple subscribers", () => {
    const emitter = new ProcessEventEmitter();
    const h1 = vi.fn();
    const h2 = vi.fn();
    emitter.subscribe(h1);
    emitter.subscribe(h2);

    const event: ProcessEvent = { type: "stopped", name, exitCode: 0 };
    emitter.emit(event);

    expect(h1).toHaveBeenCalledOnce();
    expect(h2).toHaveBeenCalledOnce();
  });

  it("unsubscribes correctly", () => {
    const emitter = new ProcessEventEmitter();
    const handler = vi.fn();
    const unsub = emitter.subscribe(handler);

    emitter.emit({ type: "spawned", name, pid: 1, port: 7700 });
    expect(handler).toHaveBeenCalledOnce();

    unsub();
    emitter.emit({ type: "stopped", name });
    expect(handler).toHaveBeenCalledOnce(); // not called again
  });

  it("tracks listener count", () => {
    const emitter = new ProcessEventEmitter();
    expect(emitter.listenerCount).toBe(0);

    const unsub1 = emitter.subscribe(() => {});
    expect(emitter.listenerCount).toBe(1);

    const unsub2 = emitter.subscribe(() => {});
    expect(emitter.listenerCount).toBe(2);

    unsub1();
    expect(emitter.listenerCount).toBe(1);

    unsub2();
    expect(emitter.listenerCount).toBe(0);
  });

  it("emits error events", () => {
    const emitter = new ProcessEventEmitter();
    const handler = vi.fn();
    emitter.subscribe(handler);

    const event: ProcessEvent = { type: "error", name, error: "crash" };
    emitter.emit(event);

    expect(handler).toHaveBeenCalledWith(event);
  });

  it("handles emit with no subscribers gracefully", () => {
    const emitter = new ProcessEventEmitter();
    expect(() =>
      emitter.emit({ type: "stopped", name }),
    ).not.toThrow();
  });

  it("isolates handler errors and logs to stderr", () => {
    const emitter = new ProcessEventEmitter();
    const good = vi.fn();
    const bad = vi.fn().mockImplementation(() => { throw new Error("handler boom"); });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    emitter.subscribe(bad);
    emitter.subscribe(good);

    const event: ProcessEvent = { type: "spawned", name, pid: 1, port: 7700 };
    emitter.emit(event);

    // Good handler still called despite bad handler throwing
    expect(good).toHaveBeenCalledWith(event);
    // Structured logger writes JSON to stderr
    expect(spy).toHaveBeenCalled();
    const logged = spy.mock.calls[0]![0] as string;
    expect(logged).toContain("Event handler threw");
    expect(logged).toContain("handler boom");
    spy.mockRestore();
  });

  it("logs non-Error thrown values as strings", () => {
    const emitter = new ProcessEventEmitter();
    const bad = vi.fn().mockImplementation(() => { throw "string error"; });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    emitter.subscribe(bad);
    emitter.emit({ type: "stopped", name });

    expect(spy).toHaveBeenCalled();
    const logged = spy.mock.calls[0]![0] as string;
    expect(logged).toContain("Event handler threw");
    expect(logged).toContain("string error");
    spy.mockRestore();
  });
});
