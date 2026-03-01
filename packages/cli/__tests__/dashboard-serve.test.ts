import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import { executeDashboardServe, registerDashboardServeCommand } from "../src/commands/dashboard-serve.js";
import { createFormatter } from "../src/formatter.js";
import type { CommandDeps } from "../src/types.js";
import type { ProcessManager } from "@mecha/process";
import type { AclEngine } from "@mecha/core";

const mockServer = {
  listen: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
};

vi.mock("@mecha/agent", () => ({
  createAgentServer: vi.fn().mockReturnValue(mockServer),
}));

vi.mock("@mecha/service", () => ({
  readNodeName: vi.fn().mockReturnValue("test-node"),
}));

vi.mock("@mecha/process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mecha/process")>();
  return {
    ...actual,
    createBunPtySpawn: vi.fn().mockReturnValue(vi.fn()),
  };
});

vi.mock("../src/spa-resolve.js", () => ({
  resolveSpaDir: vi.fn().mockReturnValue("/fake/spa/dist"),
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
    process.env.MECHA_AGENT_API_KEY = "test-key";
  });

  afterEach(() => {
    delete process.env.MECHA_AGENT_API_KEY;
  });

  it("rejects invalid port", async () => {
    const deps = makeDeps();
    const errorSpy = vi.spyOn(deps.formatter, "error");

    await executeDashboardServe({ port: "not-a-port", host: "127.0.0.1", open: false }, deps);

    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Invalid port"));
  });

  it("errors without API key", async () => {
    delete process.env.MECHA_AGENT_API_KEY;
    const deps = makeDeps();
    const errorSpy = vi.spyOn(deps.formatter, "error");

    await executeDashboardServe({ port: "7660", host: "127.0.0.1", open: false }, deps);

    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("API key required"));
  });

  it("errors when SPA not found", async () => {
    const { resolveSpaDir } = await import("../src/spa-resolve.js");
    vi.mocked(resolveSpaDir).mockReturnValueOnce(undefined);

    const deps = makeDeps();
    const errorSpy = vi.spyOn(deps.formatter, "error");

    await executeDashboardServe({ port: "7660", host: "127.0.0.1", open: false }, deps);

    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("SPA not found"));
  });

  it("starts server and registers shutdown hook", async () => {
    const deps = makeDeps();
    const successSpy = vi.spyOn(deps.formatter, "success");

    await executeDashboardServe({ port: "3457", host: "127.0.0.1", open: false }, deps);

    expect(deps.registerShutdownHook).toHaveBeenCalled();
    expect(successSpy).toHaveBeenCalledWith(expect.stringContaining("3457"));
  });

  it("works when registerShutdownHook is undefined", async () => {
    const deps = makeDeps({ registerShutdownHook: undefined });

    await executeDashboardServe({ port: "3457", host: "127.0.0.1", open: false }, deps);

    expect(process.exitCode).toBeUndefined();
  });

  it("calls openBrowser when open is true", async () => {
    const deps = makeDeps();

    await executeDashboardServe({ port: "3457", host: "127.0.0.1", open: true }, deps);

    expect(deps.registerShutdownHook).toHaveBeenCalled();
  });

  it("registers serve subcommand", () => {
    const parent = new Command("dashboard");
    const deps = makeDeps();

    registerDashboardServeCommand(parent, deps);

    const serve = parent.commands.find((c) => c.name() === "serve");
    expect(serve).toBeDefined();
    expect(serve!.description()).toBe("Start the web dashboard");
  });

  it("action callback invokes executeDashboardServe", async () => {
    const parent = new Command("dashboard");
    const deps = makeDeps();

    registerDashboardServeCommand(parent, deps);

    // Parse triggers the .action callback
    await parent.parseAsync(["serve", "--port", "7660"], { from: "user" });

    const { createAgentServer } = await import("@mecha/agent");
    expect(vi.mocked(createAgentServer)).toHaveBeenCalled();
  });
});
