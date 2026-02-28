import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeDashboardServe } from "../src/commands/dashboard-serve.js";
import { createFormatter } from "../src/formatter.js";
import type { CommandDeps } from "../src/types.js";
import type { ProcessManager } from "@mecha/process";
import type { AclEngine } from "@mecha/core";

const mockStartDashboard = vi.fn().mockResolvedValue(() => {});

vi.mock("@mecha/dashboard", () => ({
  startDashboard: (...args: unknown[]) => mockStartDashboard(...args),
}));

function makeDeps(overrides?: Partial<CommandDeps>): CommandDeps {
  return {
    formatter: createFormatter({ quiet: true }),
    processManager: {} as unknown as ProcessManager,
    mechaDir: "/tmp/mecha-test",
    acl: {} as unknown as AclEngine,
    sandbox: {} as never,
    registerShutdownHook: vi.fn(),
    ...overrides,
  };
}

describe("executeDashboardServe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
  });

  it("rejects invalid port", async () => {
    const deps = makeDeps();
    const errorSpy = vi.spyOn(deps.formatter, "error");

    await executeDashboardServe({ port: "not-a-port", host: "127.0.0.1", open: false, sessionTtl: "24" }, deps);

    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Invalid port"));
  });

  it("starts dashboard and registers shutdown hook", async () => {
    const deps = makeDeps();
    const successSpy = vi.spyOn(deps.formatter, "success");

    await executeDashboardServe({ port: "3457", host: "127.0.0.1", open: false, sessionTtl: "24" }, deps);

    expect(deps.registerShutdownHook).toHaveBeenCalled();
    expect(successSpy).toHaveBeenCalledWith(expect.stringContaining("3457"));
  });

  it("works when registerShutdownHook is undefined", async () => {
    const deps = makeDeps({ registerShutdownHook: undefined });

    await executeDashboardServe({ port: "3457", host: "127.0.0.1", open: false, sessionTtl: "24" }, deps);

    expect(process.exitCode).toBeUndefined();
  });

  it("calls openBrowser when open is true", async () => {
    const deps = makeDeps();

    await executeDashboardServe({ port: "3457", host: "127.0.0.1", open: true, sessionTtl: "24" }, deps);

    expect(deps.registerShutdownHook).toHaveBeenCalled();
  });

  it("passes sessionTtlHours to startDashboard", async () => {
    const deps = makeDeps();

    await executeDashboardServe({ port: "3457", host: "127.0.0.1", open: false, sessionTtl: "8" }, deps);

    expect(mockStartDashboard).toHaveBeenCalledWith(
      expect.objectContaining({ sessionTtlHours: 8 }),
    );
  });

  it("omits sessionTtlHours for invalid values", async () => {
    const deps = makeDeps();

    await executeDashboardServe({ port: "3457", host: "127.0.0.1", open: false, sessionTtl: "abc" }, deps);

    expect(mockStartDashboard).toHaveBeenCalledWith(
      expect.objectContaining({ sessionTtlHours: undefined }),
    );
  });
});
