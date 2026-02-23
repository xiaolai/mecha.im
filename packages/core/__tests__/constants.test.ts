import { describe, it, expect } from "vitest";
import { MECHA_DIR, CASAS_DIR, IDENTITY_DIR, DEFAULTS } from "../src/constants.js";

describe("constants", () => {
  it("MECHA_DIR is .mecha", () => {
    expect(MECHA_DIR).toBe(".mecha");
  });

  it("CASAS_DIR is casas", () => {
    expect(CASAS_DIR).toBe("casas");
  });

  it("IDENTITY_DIR is identity", () => {
    expect(IDENTITY_DIR).toBe("identity");
  });

  it("DEFAULTS has expected port values", () => {
    expect(DEFAULTS.RUNTIME_PORT_BASE).toBe(7700);
    expect(DEFAULTS.RUNTIME_PORT_MAX).toBe(7799);
    expect(DEFAULTS.AGENT_PORT).toBe(7660);
    expect(DEFAULTS.MCP_HTTP_PORT).toBe(7670);
    expect(DEFAULTS.DASHBOARD_PORT).toBe(3457);
  });

  it("DEFAULTS port range is valid", () => {
    expect(DEFAULTS.RUNTIME_PORT_BASE).toBeLessThan(DEFAULTS.RUNTIME_PORT_MAX);
  });
});
