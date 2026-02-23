import { describe, it, expect } from "vitest";
import {
  PERMISSION_MODES,
  PermissionMode,
  BLOCKED_ENV_KEYS,
  MechaUpInput,
  MechaUpResult,
  MechaRmInput,
  MechaConfigureInput,
  MechaLogsInput,
  MechaLsItem,
  MechaStatusResult,
  DoctorResult,
  UiUrlResult,
  McpEndpointResult,
  SessionConfig,
  SessionCreateInput,
  SessionMessageInput,
  SessionGetInput,
  SessionDeleteInput,
  SessionInterruptInput,
  SessionConfigUpdateInput,
  SessionListInput,
  SessionMetaUpdate,
} from "../src/schemas.js";

describe("PERMISSION_MODES", () => {
  it("contains exactly default, plan, full-auto", () => {
    expect(PERMISSION_MODES).toEqual(["default", "plan", "full-auto"]);
  });

  it("parses valid modes", () => {
    for (const mode of PERMISSION_MODES) {
      expect(PermissionMode.parse(mode)).toBe(mode);
    }
  });

  it("rejects invalid mode", () => {
    expect(() => PermissionMode.parse("yolo")).toThrow();
  });
});

describe("BLOCKED_ENV_KEYS", () => {
  it("blocks security-sensitive keys", () => {
    expect(BLOCKED_ENV_KEYS.has("MECHA_AUTH_TOKEN")).toBe(true);
    expect(BLOCKED_ENV_KEYS.has("CLAUDE_CODE_OAUTH_TOKEN")).toBe(true);
    expect(BLOCKED_ENV_KEYS.has("ANTHROPIC_API_KEY")).toBe(true);
    expect(BLOCKED_ENV_KEYS.has("MECHA_ID")).toBe(true);
    expect(BLOCKED_ENV_KEYS.has("PATH")).toBe(true);
    expect(BLOCKED_ENV_KEYS.has("LD_PRELOAD")).toBe(true);
  });

  it("does not block arbitrary keys", () => {
    expect(BLOCKED_ENV_KEYS.has("MY_CUSTOM_VAR")).toBe(false);
  });
});

describe("MechaUpInput", () => {
  it("parses valid minimal input", () => {
    const result = MechaUpInput.parse({ projectPath: "/tmp/test" });
    expect(result.projectPath).toBe("/tmp/test");
    expect(result.port).toBeUndefined();
    expect(result.claudeToken).toBeUndefined();
    expect(result.anthropicApiKey).toBeUndefined();
    expect(result.otp).toBeUndefined();
    expect(result.permissionMode).toBeUndefined();
    expect(result.env).toBeUndefined();
  });

  it("parses full input with all fields", () => {
    const input = {
      projectPath: "/home/user/project",
      port: 7700,
      claudeToken: "tok_abc",
      anthropicApiKey: "sk-ant-123",
      otp: "JBSWY3DPEHPK3PXP",
      permissionMode: "full-auto" as const,
      env: ["MY_VAR=hello"],
    };
    const result = MechaUpInput.parse(input);
    expect(result).toEqual(input);
  });

  it("rejects empty projectPath", () => {
    expect(() => MechaUpInput.parse({ projectPath: "" })).toThrow();
  });

  it("rejects port below 1024", () => {
    expect(() => MechaUpInput.parse({ projectPath: "/tmp", port: 80 })).toThrow();
  });

  it("rejects port above 65535", () => {
    expect(() => MechaUpInput.parse({ projectPath: "/tmp", port: 70000 })).toThrow();
  });

  it("rejects non-integer port", () => {
    expect(() => MechaUpInput.parse({ projectPath: "/tmp", port: 7700.5 })).toThrow();
  });

  it("rejects invalid permission mode", () => {
    expect(() => MechaUpInput.parse({ projectPath: "/tmp", permissionMode: "dangerous" })).toThrow();
  });

  it("rejects env entries with blocked keys", () => {
    expect(() => MechaUpInput.parse({ projectPath: "/tmp", env: ["MECHA_AUTH_TOKEN=secret"] })).toThrow();
    expect(() => MechaUpInput.parse({ projectPath: "/tmp", env: ["PATH=/usr/bin"] })).toThrow();
    expect(() => MechaUpInput.parse({ projectPath: "/tmp", env: ["CLAUDE_CODE_OAUTH_TOKEN=tok"] })).toThrow();
  });

  it("rejects env entries without = separator", () => {
    expect(() => MechaUpInput.parse({ projectPath: "/tmp", env: ["NOEQUALS"] })).toThrow();
  });

  it("rejects env entries with lowercase keys", () => {
    expect(() => MechaUpInput.parse({ projectPath: "/tmp", env: ["lowercase=val"] })).toThrow();
  });

  it("rejects env entries starting with =", () => {
    expect(() => MechaUpInput.parse({ projectPath: "/tmp", env: ["=value"] })).toThrow();
  });

  it("accepts valid env entries", () => {
    const result = MechaUpInput.parse({ projectPath: "/tmp", env: ["MY_VAR=hello", "FOO123=bar"] });
    expect(result.env).toEqual(["MY_VAR=hello", "FOO123=bar"]);
  });

  it("accepts boundary port values", () => {
    expect(MechaUpInput.parse({ projectPath: "/tmp", port: 1024 }).port).toBe(1024);
    expect(MechaUpInput.parse({ projectPath: "/tmp", port: 65535 }).port).toBe(65535);
  });
});

describe("MechaUpResult", () => {
  it("parses valid result", () => {
    const result = MechaUpResult.parse({ id: "mx-foo-abc123", name: "mecha-mx-foo-abc123", port: 7700, authToken: "a".repeat(64) });
    expect(result.id).toBe("mx-foo-abc123");
    expect(result.port).toBe(7700);
  });

  it("rejects missing fields", () => {
    expect(() => MechaUpResult.parse({ id: "mx-foo" })).toThrow();
  });
});

describe("MechaRmInput", () => {
  it("parses with defaults", () => {
    const result = MechaRmInput.parse({ id: "mx-foo-abc123" });
    expect(result.id).toBe("mx-foo-abc123");
    expect(result.withState).toBe(false);
    expect(result.force).toBe(false);
  });

  it("parses with flags", () => {
    const result = MechaRmInput.parse({ id: "mx-foo-abc123", withState: true, force: true });
    expect(result.withState).toBe(true);
    expect(result.force).toBe(true);
  });

  it("rejects empty id", () => {
    expect(() => MechaRmInput.parse({ id: "" })).toThrow();
  });
});

describe("MechaConfigureInput", () => {
  it("parses with all optional fields", () => {
    const result = MechaConfigureInput.parse({
      id: "mx-foo-abc123",
      claudeToken: "tok",
      anthropicApiKey: "sk-ant",
      otp: "secret",
      permissionMode: "plan",
    });
    expect(result.claudeToken).toBe("tok");
    expect(result.anthropicApiKey).toBe("sk-ant");
    expect(result.otp).toBe("secret");
    expect(result.permissionMode).toBe("plan");
  });

  it("parses with only id", () => {
    const result = MechaConfigureInput.parse({ id: "mx-foo" });
    expect(result.claudeToken).toBeUndefined();
    expect(result.anthropicApiKey).toBeUndefined();
  });

  it("rejects invalid permission mode", () => {
    expect(() => MechaConfigureInput.parse({ id: "mx-foo", permissionMode: "nope" })).toThrow();
  });
});

describe("MechaLogsInput", () => {
  it("parses with defaults", () => {
    const result = MechaLogsInput.parse({ id: "mx-foo" });
    expect(result.follow).toBe(false);
    expect(result.tail).toBe(100);
    expect(result.since).toBeUndefined();
  });

  it("parses with all fields", () => {
    const result = MechaLogsInput.parse({ id: "mx-foo", follow: true, tail: 50, since: 1700000000 });
    expect(result.follow).toBe(true);
    expect(result.tail).toBe(50);
    expect(result.since).toBe(1700000000);
  });

  it("rejects negative tail", () => {
    expect(() => MechaLogsInput.parse({ id: "mx-foo", tail: -1 })).toThrow();
  });
});

describe("MechaLsItem", () => {
  it("parses valid item with optional port", () => {
    const item = { id: "mx-foo", name: "mecha-mx-foo", state: "running", status: "Up 5 min", path: "/tmp", port: 7700, created: 1700000000 };
    expect(MechaLsItem.parse(item)).toEqual(item);
  });

  it("parses without port", () => {
    const item = { id: "mx-foo", name: "mecha-mx-foo", state: "exited", status: "Exited (0)", path: "/tmp", created: 1700000000 };
    const result = MechaLsItem.parse(item);
    expect(result.port).toBeUndefined();
  });
});

describe("MechaStatusResult", () => {
  it("parses full status", () => {
    const status = {
      id: "mx-foo", name: "mecha-mx-foo", state: "running", running: true,
      port: 7700, path: "/tmp", pid: 12345,
      startedAt: "2025-01-01T00:00:00Z", finishedAt: "",
    };
    expect(MechaStatusResult.parse(status)).toEqual(status);
  });

  it("parses without optional fields", () => {
    const status = { id: "mx-foo", name: "n", state: "exited", running: false, path: "/tmp" };
    const result = MechaStatusResult.parse(status);
    expect(result.port).toBeUndefined();
    expect(result.pid).toBeUndefined();
    expect(result.startedAt).toBeUndefined();
  });
});

describe("DoctorResult", () => {
  it("parses healthy result", () => {
    const result = DoctorResult.parse({ claudeCliAvailable: true, sandboxSupported: true, issues: [] });
    expect(result.issues).toHaveLength(0);
  });

  it("parses unhealthy result", () => {
    const result = DoctorResult.parse({ claudeCliAvailable: false, sandboxSupported: false, issues: ["Claude CLI not found"] });
    expect(result.issues).toEqual(["Claude CLI not found"]);
  });
});

describe("UiUrlResult", () => {
  it("parses valid url", () => {
    expect(UiUrlResult.parse({ url: "http://127.0.0.1:7700" }).url).toBe("http://127.0.0.1:7700");
  });
});

describe("McpEndpointResult", () => {
  it("parses valid endpoint", () => {
    const result = McpEndpointResult.parse({ endpoint: "http://127.0.0.1:7700/mcp", token: "abc123" });
    expect(result.endpoint).toBe("http://127.0.0.1:7700/mcp");
    expect(result.token).toBe("abc123");
  });

  it("parses endpoint without token", () => {
    const result = McpEndpointResult.parse({ endpoint: "http://127.0.0.1:7700/mcp" });
    expect(result.endpoint).toBe("http://127.0.0.1:7700/mcp");
    expect(result.token).toBeUndefined();
  });
});

describe("SessionConfig", () => {
  it("parses valid config with all fields", () => {
    const result = SessionConfig.parse({
      maxTurns: 10,
      systemPrompt: "You are helpful",
      permissionMode: "plan",
      model: "claude-sonnet-4-20250514",
      maxBudgetUsd: 5.0,
    });
    expect(result.maxTurns).toBe(10);
    expect(result.systemPrompt).toBe("You are helpful");
    expect(result.permissionMode).toBe("plan");
    expect(result.model).toBe("claude-sonnet-4-20250514");
    expect(result.maxBudgetUsd).toBe(5.0);
  });

  it("parses valid empty object (all fields optional)", () => {
    const result = SessionConfig.parse({});
    expect(result.maxTurns).toBeUndefined();
    expect(result.systemPrompt).toBeUndefined();
    expect(result.permissionMode).toBeUndefined();
    expect(result.model).toBeUndefined();
    expect(result.maxBudgetUsd).toBeUndefined();
  });

  it("rejects negative maxTurns", () => {
    expect(() => SessionConfig.parse({ maxTurns: -1 })).toThrow();
  });

  it("rejects zero maxTurns", () => {
    expect(() => SessionConfig.parse({ maxTurns: 0 })).toThrow();
  });

  it("rejects negative maxBudgetUsd", () => {
    expect(() => SessionConfig.parse({ maxBudgetUsd: -5 })).toThrow();
  });

  it("rejects invalid permissionMode", () => {
    expect(() => SessionConfig.parse({ permissionMode: "dangerous" })).toThrow();
  });
});

describe("SessionCreateInput", () => {
  it("parses valid input with id only", () => {
    const result = SessionCreateInput.parse({ id: "mx-foo" });
    expect(result.id).toBe("mx-foo");
    expect(result.title).toBeUndefined();
    expect(result.config).toBeUndefined();
  });

  it("parses valid input with title and config", () => {
    const result = SessionCreateInput.parse({
      id: "mx-foo",
      title: "My session",
      config: { maxTurns: 5, model: "claude-sonnet-4-20250514" },
    });
    expect(result.title).toBe("My session");
    expect(result.config?.maxTurns).toBe(5);
    expect(result.config?.model).toBe("claude-sonnet-4-20250514");
  });

  it("rejects empty id", () => {
    expect(() => SessionCreateInput.parse({ id: "" })).toThrow();
  });
});

describe("SessionMessageInput", () => {
  it("parses valid input", () => {
    const result = SessionMessageInput.parse({ id: "mx-foo", sessionId: "sess-1", message: "hello" });
    expect(result.id).toBe("mx-foo");
    expect(result.sessionId).toBe("sess-1");
    expect(result.message).toBe("hello");
  });

  it("rejects empty message", () => {
    expect(() => SessionMessageInput.parse({ id: "mx-foo", sessionId: "sess-1", message: "" })).toThrow();
  });

  it("rejects empty sessionId", () => {
    expect(() => SessionMessageInput.parse({ id: "mx-foo", sessionId: "", message: "hello" })).toThrow();
  });

  it("rejects empty id", () => {
    expect(() => SessionMessageInput.parse({ id: "", sessionId: "sess-1", message: "hello" })).toThrow();
  });
});

describe("SessionGetInput", () => {
  it("parses valid input", () => {
    const result = SessionGetInput.parse({ id: "mx-foo", sessionId: "sess-1" });
    expect(result.id).toBe("mx-foo");
    expect(result.sessionId).toBe("sess-1");
  });

  it("rejects empty id", () => {
    expect(() => SessionGetInput.parse({ id: "", sessionId: "sess-1" })).toThrow();
  });

  it("rejects empty sessionId", () => {
    expect(() => SessionGetInput.parse({ id: "mx-foo", sessionId: "" })).toThrow();
  });
});

describe("SessionDeleteInput", () => {
  it("parses valid input", () => {
    const result = SessionDeleteInput.parse({ id: "mx-foo", sessionId: "sess-1" });
    expect(result.id).toBe("mx-foo");
    expect(result.sessionId).toBe("sess-1");
  });

  it("rejects empty id", () => {
    expect(() => SessionDeleteInput.parse({ id: "", sessionId: "sess-1" })).toThrow();
  });

  it("rejects empty sessionId", () => {
    expect(() => SessionDeleteInput.parse({ id: "mx-foo", sessionId: "" })).toThrow();
  });
});

describe("SessionInterruptInput", () => {
  it("parses valid input", () => {
    const result = SessionInterruptInput.parse({ id: "mx-foo", sessionId: "sess-1" });
    expect(result.id).toBe("mx-foo");
    expect(result.sessionId).toBe("sess-1");
  });

  it("rejects empty id", () => {
    expect(() => SessionInterruptInput.parse({ id: "", sessionId: "sess-1" })).toThrow();
  });

  it("rejects empty sessionId", () => {
    expect(() => SessionInterruptInput.parse({ id: "mx-foo", sessionId: "" })).toThrow();
  });
});

describe("SessionConfigUpdateInput", () => {
  it("parses valid input", () => {
    const result = SessionConfigUpdateInput.parse({
      id: "mx-foo",
      sessionId: "sess-1",
      config: { maxTurns: 20, permissionMode: "full-auto" },
    });
    expect(result.id).toBe("mx-foo");
    expect(result.sessionId).toBe("sess-1");
    expect(result.config.maxTurns).toBe(20);
    expect(result.config.permissionMode).toBe("full-auto");
  });

  it("rejects empty id", () => {
    expect(() => SessionConfigUpdateInput.parse({ id: "", sessionId: "sess-1", config: {} })).toThrow();
  });

  it("rejects empty sessionId", () => {
    expect(() => SessionConfigUpdateInput.parse({ id: "mx-foo", sessionId: "", config: {} })).toThrow();
  });
});

describe("SessionListInput", () => {
  it("parses valid input", () => {
    const result = SessionListInput.parse({ id: "mx-foo" });
    expect(result.id).toBe("mx-foo");
  });

  it("rejects empty id", () => {
    expect(() => SessionListInput.parse({ id: "" })).toThrow();
  });
});

describe("SessionMetaUpdate", () => {
  it("parses valid update with customTitle only", () => {
    const result = SessionMetaUpdate.parse({ customTitle: "My Session" });
    expect(result.customTitle).toBe("My Session");
    expect(result.starred).toBeUndefined();
  });

  it("parses valid update with starred only", () => {
    const result = SessionMetaUpdate.parse({ starred: true });
    expect(result.starred).toBe(true);
    expect(result.customTitle).toBeUndefined();
  });

  it("parses valid update with both fields", () => {
    const result = SessionMetaUpdate.parse({ customTitle: "Title", starred: false });
    expect(result.customTitle).toBe("Title");
    expect(result.starred).toBe(false);
  });

  it("parses null customTitle (for clearing)", () => {
    const result = SessionMetaUpdate.parse({ customTitle: null });
    expect(result.customTitle).toBeNull();
  });

  it("parses null starred (for clearing)", () => {
    const result = SessionMetaUpdate.parse({ starred: null });
    expect(result.starred).toBeNull();
  });

  it("rejects empty object (at least one field required)", () => {
    expect(() => SessionMetaUpdate.parse({})).toThrow();
  });

  it("rejects customTitle exceeding 200 chars", () => {
    expect(() => SessionMetaUpdate.parse({ customTitle: "x".repeat(201) })).toThrow();
  });

  it("accepts customTitle at exactly 200 chars", () => {
    const result = SessionMetaUpdate.parse({ customTitle: "x".repeat(200) });
    expect(result.customTitle).toHaveLength(200);
  });
});
