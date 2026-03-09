import { describe, it, expect } from "vitest";
import {
  BotSpawnInput,
  BotKillInput,
  SessionCreateInput,
  SessionMessageInput,
  PermissionMode,
} from "../src/schemas.js";

describe("BotSpawnInput", () => {
  it("accepts valid minimal input", () => {
    const result = BotSpawnInput.parse({
      name: "researcher",
      workspacePath: "/tmp/workspace",
    });
    expect(result.name).toBe("researcher");
    expect(result.workspacePath).toBe("/tmp/workspace");
  });

  it("accepts full input with all options", () => {
    const result = BotSpawnInput.parse({
      name: "gpu-worker",
      workspacePath: "/home/user/project",
      tags: ["dev", "gpu"],
      env: { API_KEY: "secret" },
      model: "claude-sonnet-4-20250514",
      permissionMode: "bypassPermissions",
      port: 7710,
      auth: "personal",
    });
    expect(result.tags).toEqual(["dev", "gpu"]);
    expect(result.permissionMode).toBe("bypassPermissions");
    expect(result.port).toBe(7710);
    expect(result.auth).toBe("personal");
  });

  it("accepts input without auth (optional)", () => {
    const result = BotSpawnInput.parse({
      name: "researcher",
      workspacePath: "/tmp/workspace",
    });
    expect(result.auth).toBeUndefined();
  });

  it("rejects empty name", () => {
    expect(() =>
      BotSpawnInput.parse({ name: "", workspacePath: "/tmp" }),
    ).toThrow();
  });

  it("rejects uppercase name", () => {
    expect(() =>
      BotSpawnInput.parse({ name: "UPPER", workspacePath: "/tmp" }),
    ).toThrow();
  });

  it("rejects name with leading hyphen", () => {
    expect(() =>
      BotSpawnInput.parse({ name: "-bad", workspacePath: "/tmp" }),
    ).toThrow();
  });

  it("rejects name longer than 32 chars", () => {
    expect(() =>
      BotSpawnInput.parse({ name: "a".repeat(33), workspacePath: "/tmp" }),
    ).toThrow();
  });

  it("rejects empty workspacePath", () => {
    expect(() =>
      BotSpawnInput.parse({ name: "ok", workspacePath: "" }),
    ).toThrow();
  });

  it("rejects invalid port", () => {
    expect(() =>
      BotSpawnInput.parse({ name: "ok", workspacePath: "/tmp", port: 0 }),
    ).toThrow();
    expect(() =>
      BotSpawnInput.parse({ name: "ok", workspacePath: "/tmp", port: 70000 }),
    ).toThrow();
  });

  it("rejects invalid permission mode", () => {
    expect(() =>
      BotSpawnInput.parse({
        name: "ok",
        workspacePath: "/tmp",
        permissionMode: "invalid",
      }),
    ).toThrow();
  });
});

describe("BotKillInput", () => {
  it("accepts valid input", () => {
    const result = BotKillInput.parse({ name: "researcher" });
    expect(result.name).toBe("researcher");
    expect(result.force).toBeUndefined();
  });

  it("accepts force option", () => {
    const result = BotKillInput.parse({ name: "researcher", force: true });
    expect(result.force).toBe(true);
  });

  it("rejects invalid name", () => {
    expect(() => BotKillInput.parse({ name: "" })).toThrow();
  });
});

describe("SessionCreateInput", () => {
  it("accepts empty input", () => {
    const result = SessionCreateInput.parse({});
    expect(result.title).toBeUndefined();
  });

  it("accepts title and model", () => {
    const result = SessionCreateInput.parse({
      title: "Debug session",
      model: "claude-sonnet-4-20250514",
    });
    expect(result.title).toBe("Debug session");
  });
});

describe("SessionMessageInput", () => {
  it("accepts valid message", () => {
    const result = SessionMessageInput.parse({ message: "hello" });
    expect(result.message).toBe("hello");
  });

  it("rejects empty message", () => {
    expect(() => SessionMessageInput.parse({ message: "" })).toThrow();
  });

  it("accepts optional model", () => {
    const result = SessionMessageInput.parse({
      message: "hello",
      model: "claude-haiku-4-5-20251001",
    });
    expect(result.model).toBe("claude-haiku-4-5-20251001");
  });
});

describe("PermissionMode", () => {
  it("accepts valid modes", () => {
    expect(PermissionMode.parse("default")).toBe("default");
    expect(PermissionMode.parse("plan")).toBe("plan");
    expect(PermissionMode.parse("bypassPermissions")).toBe("bypassPermissions");
    expect(PermissionMode.parse("acceptEdits")).toBe("acceptEdits");
    expect(PermissionMode.parse("dontAsk")).toBe("dontAsk");
    expect(PermissionMode.parse("auto")).toBe("auto");
  });

  it("rejects invalid mode", () => {
    expect(() => PermissionMode.parse("unknown")).toThrow();
  });
});
