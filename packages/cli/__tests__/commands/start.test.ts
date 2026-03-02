import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createProgram } from "../../src/program.js";
import { makeDeps } from "../test-utils.js";

let dir: string;

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "start-test-")); });
afterEach(() => {
  process.exitCode = undefined as unknown as number;
  delete process.env.MECHA_AGENT_API_KEY;
  rmSync(dir, { recursive: true, force: true });
});

const mockServer = {
  listen: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
};

vi.mock("@mecha/agent", () => ({
  createAgentServer: vi.fn().mockReturnValue(mockServer),
}));

vi.mock("@mecha/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mecha/service")>();
  return {
    ...actual,
    readNodeName: vi.fn().mockReturnValue("test-node"),
  };
});

vi.mock("@mecha/process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mecha/process")>();
  return {
    ...actual,
    createBunPtySpawn: vi.fn().mockReturnValue(vi.fn()),
  };
});

vi.mock("../../src/spa-resolve.js", () => ({
  resolveSpaDir: vi.fn().mockReturnValue("/fake/spa/dist"),
}));

vi.mock("../../src/totp-display.js", () => ({
  displayTotpSetup: vi.fn().mockResolvedValue(undefined),
}));

describe("start command", () => {
  it("starts with TOTP by default (auto-generates secret)", async () => {
    const hooks: Array<() => Promise<void>> = [];
    const deps = makeDeps({ mechaDir: dir, registerShutdownHook: (fn) => hooks.push(fn) });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "start"]);
    expect(deps.formatter.success).toHaveBeenCalledWith(expect.stringContaining("Mecha started"));
    expect(deps.formatter.success).toHaveBeenCalledWith(expect.stringContaining("TOTP"));
  });

  it("starts with API key from env", async () => {
    process.env.MECHA_AGENT_API_KEY = "test-key";
    const deps = makeDeps({ mechaDir: dir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "start"]);
    expect(deps.formatter.success).toHaveBeenCalledWith(expect.stringContaining("Mecha started"));
  });

  it("starts with --api-key flag", async () => {
    const deps = makeDeps({ mechaDir: dir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "start", "--api-key", "mykey"]);
    expect(deps.formatter.success).toHaveBeenCalledWith(expect.stringContaining("API key"));
  });

  it("warns when SPA not found", async () => {
    const { resolveSpaDir } = await import("../../src/spa-resolve.js");
    vi.mocked(resolveSpaDir).mockReturnValueOnce(undefined);

    const deps = makeDeps({ mechaDir: dir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "start"]);
    expect(deps.formatter.success).toHaveBeenCalledWith(expect.stringContaining("Agent server started"));
    expect(deps.formatter.warn).toHaveBeenCalledWith(expect.stringContaining("SPA not found"));
  });

  it("starts with --no-api-key (TOTP only)", async () => {
    const deps = makeDeps({ mechaDir: dir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "start", "--no-api-key"]);
    expect(deps.formatter.success).toHaveBeenCalledWith(expect.stringContaining("TOTP"));
  });

  it("errors when --no-totp without --api-key", async () => {
    const deps = makeDeps({ mechaDir: dir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "start", "--no-totp"]);
    expect(deps.formatter.error).toHaveBeenCalledWith(expect.stringContaining("At least one auth method"));
    expect(process.exitCode).toBe(1);
  });

  it("errors when api-key enabled in config but no key provided", async () => {
    const { writeAuthConfig } = await import("@mecha/core");
    writeAuthConfig(dir, { totp: false, apiKey: true });

    const deps = makeDeps({ mechaDir: dir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "start", "--no-totp"]);
    expect(deps.formatter.error).toHaveBeenCalledWith(
      expect.stringContaining("API key auth enabled but no key provided"),
    );
    expect(process.exitCode).toBe(1);
  });

  it("rejects invalid agent port", async () => {
    const deps = makeDeps({ mechaDir: dir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "start", "--port", "abc"]);
    expect(deps.formatter.error).toHaveBeenCalledWith(expect.stringContaining("Invalid port"));
    expect(process.exitCode).toBe(1);
  });

  it("forwards port option to server", async () => {
    const deps = makeDeps({ mechaDir: dir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "start", "--port", "7700"]);
    expect(mockServer.listen).toHaveBeenCalledWith(expect.objectContaining({ port: 7700 }));
  });
});
