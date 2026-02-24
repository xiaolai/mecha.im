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
});
