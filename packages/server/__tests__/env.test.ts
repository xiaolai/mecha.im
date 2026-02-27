import { describe, it, expect } from "vitest";
import { parseServerEnv } from "../src/env.js";

describe("parseServerEnv", () => {
  it("returns defaults when no env vars set", () => {
    const env = parseServerEnv({});
    expect(env.port).toBe(7680);
    expect(env.host).toBe("0.0.0.0");
    expect(env.relayUrl).toBe("wss://relay.mecha.im");
  });

  it("parses PORT from env", () => {
    const env = parseServerEnv({ PORT: "9090" });
    expect(env.port).toBe(9090);
  });

  it("throws on non-numeric PORT", () => {
    expect(() => parseServerEnv({ PORT: "abc" })).toThrow('Invalid PORT: "abc"');
  });

  it("throws on PORT out of range", () => {
    expect(() => parseServerEnv({ PORT: "70000" })).toThrow('Invalid PORT: "70000"');
  });

  it("throws on negative PORT", () => {
    expect(() => parseServerEnv({ PORT: "-1" })).toThrow('Invalid PORT: "-1"');
  });

  it("accepts HOST override", () => {
    const env = parseServerEnv({ HOST: "127.0.0.1" });
    expect(env.host).toBe("127.0.0.1");
  });

  it("accepts RELAY_URL override", () => {
    const env = parseServerEnv({ RELAY_URL: "ws://localhost:8080" });
    expect(env.relayUrl).toBe("ws://localhost:8080");
  });
});
