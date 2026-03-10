import { describe, it, expect } from "vitest";
import {
  MECHA_DIR,
  TOOLS_DIR,
  AUTH_DIR,
  IDENTITY_DIR,
  MANAGED_TOOLS,
  DEFAULTS,
} from "../src/constants.js";

describe("constants", () => {
  it("MECHA_DIR is .mecha", () => {
    expect(MECHA_DIR).toBe(".mecha");
  });

  it("TOOLS_DIR is tools", () => {
    expect(TOOLS_DIR).toBe("tools");
  });

  it("AUTH_DIR is auth", () => {
    expect(AUTH_DIR).toBe("auth");
  });

  it("IDENTITY_DIR is identity", () => {
    expect(IDENTITY_DIR).toBe("identity");
  });

  it("MANAGED_TOOLS has expected entries", () => {
    expect(MANAGED_TOOLS.claude).toBe("@anthropic-ai/claude-code");
    expect(MANAGED_TOOLS.codex).toBe("@openai/codex");
  });

  it("DEFAULTS has expected port values", () => {
    expect(DEFAULTS.RUNTIME_PORT_BASE).toBe(7700);
    expect(DEFAULTS.RUNTIME_PORT_MAX).toBe(7799);
    expect(DEFAULTS.AGENT_PORT).toBe(7660);
    expect(DEFAULTS.MCP_HTTP_PORT).toBe(7682);
    expect(DEFAULTS.DASHBOARD_PORT).toBe(3457);
  });

  it("DEFAULTS port range is valid", () => {
    expect(DEFAULTS.RUNTIME_PORT_BASE).toBeLessThan(DEFAULTS.RUNTIME_PORT_MAX);
  });
});
