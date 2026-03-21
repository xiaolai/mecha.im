import { describe, it, expect } from "vitest";
import { parseRuntimeEnv } from "../src/env.js";

const validEnv = {
  MECHA_BOT_NAME: "test-bot",
  MECHA_PORT: "7700",
  MECHA_AUTH_TOKEN: "mecha_abc123",
  MECHA_PROJECTS_DIR: "/projects",
  MECHA_WORKSPACE: "/workspace",
};

describe("parseRuntimeEnv", () => {
  it("parses valid environment", () => {
    const result = parseRuntimeEnv(validEnv);
    expect(result.MECHA_BOT_NAME).toBe("test-bot");
    expect(result.MECHA_PORT).toBe(7700);
    expect(result.MECHA_AUTH_TOKEN).toBe("mecha_abc123");
    expect(result.MECHA_PROJECTS_DIR).toBe("/projects");
    expect(result.MECHA_WORKSPACE).toBe("/workspace");
    expect(result.MECHA_DIR).toBeUndefined();
    expect(result.MECHA_SANDBOX_ROOT).toBeUndefined();
  });

  it("includes optional fields when provided", () => {
    const result = parseRuntimeEnv({
      ...validEnv,
      MECHA_DIR: "/mecha",
      MECHA_SANDBOX_ROOT: "/sandbox",
    });
    expect(result.MECHA_DIR).toBe("/mecha");
    expect(result.MECHA_SANDBOX_ROOT).toBe("/sandbox");
  });

  it("throws on missing required fields", () => {
    expect(() => parseRuntimeEnv({})).toThrow("Invalid runtime environment");
    expect(() => parseRuntimeEnv({})).toThrow("MECHA_BOT_NAME");
  });

  it("throws on empty bot name", () => {
    expect(() => parseRuntimeEnv({ ...validEnv, MECHA_BOT_NAME: "" })).toThrow("MECHA_BOT_NAME");
  });

  it("throws on non-numeric port", () => {
    expect(() => parseRuntimeEnv({ ...validEnv, MECHA_PORT: "abc" })).toThrow("MECHA_PORT");
  });

  it("throws on port 0", () => {
    expect(() => parseRuntimeEnv({ ...validEnv, MECHA_PORT: "0" })).toThrow("MECHA_PORT");
  });

  it("throws on port above 65535", () => {
    expect(() => parseRuntimeEnv({ ...validEnv, MECHA_PORT: "99999" })).toThrow("MECHA_PORT");
  });

  it("accepts port at boundary (1 and 65535)", () => {
    expect(parseRuntimeEnv({ ...validEnv, MECHA_PORT: "1" }).MECHA_PORT).toBe(1);
    expect(parseRuntimeEnv({ ...validEnv, MECHA_PORT: "65535" }).MECHA_PORT).toBe(65535);
  });

  it("throws on empty auth token", () => {
    expect(() => parseRuntimeEnv({ ...validEnv, MECHA_AUTH_TOKEN: "" })).toThrow("MECHA_AUTH_TOKEN");
  });
});
