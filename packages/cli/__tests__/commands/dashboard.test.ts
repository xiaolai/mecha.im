import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createProgram } from "../../src/program.js";
import { makeDeps } from "../test-utils.js";

let dir: string;

const mockServer = {
  listen: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
};

const mockCreateAgentServer = vi.fn().mockReturnValue(mockServer);

vi.mock("@mecha/agent", () => ({
  createAgentServer: (...args: unknown[]) => mockCreateAgentServer(...args),
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

vi.mock("../../src/spa-resolve.js", () => ({
  resolveSpaDir: vi.fn().mockResolvedValue("/fake/spa/dist"),
}));

vi.mock("../../src/totp-display.js", () => ({
  displayTotpSetup: vi.fn().mockResolvedValue(undefined),
}));

describe("dashboard commands", () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "dash-test-"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    mockCreateAgentServer.mockClear();
    mockCreateAgentServer.mockReturnValue(mockServer);
    mockServer.listen.mockClear();
    process.exitCode = undefined as unknown as number;
    rmSync(dir, { recursive: true, force: true });
  });

  describe("dashboard serve", () => {
    it("starts the dashboard with default port", async () => {
      const deps = makeDeps({ mechaDir: dir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "dashboard", "serve"]);
      expect(mockCreateAgentServer).toHaveBeenCalledWith(
        expect.objectContaining({
          spaDir: "/fake/spa/dist",
        }),
      );
      expect(deps.formatter.success).toHaveBeenCalledWith(
        expect.stringContaining("Dashboard started"),
      );
    });

    it("accepts custom port", async () => {
      const deps = makeDeps({ mechaDir: dir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "dashboard", "serve", "--port", "4000"]);
      expect(mockServer.listen).toHaveBeenCalledWith(
        expect.objectContaining({ port: 4000 }),
      );
      expect(deps.formatter.success).toHaveBeenCalledWith(
        expect.stringContaining("4000"),
      );
    });

    it("accepts custom host", async () => {
      const deps = makeDeps({ mechaDir: dir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "dashboard", "serve", "--host", "0.0.0.0"]);
      expect(mockServer.listen).toHaveBeenCalledWith(
        expect.objectContaining({ host: "0.0.0.0" }),
      );
    });

    it("passes processManager, mechaDir, and acl to createAgentServer", async () => {
      const deps = makeDeps({ mechaDir: dir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "dashboard", "serve"]);
      expect(mockCreateAgentServer).toHaveBeenCalledWith(
        expect.objectContaining({
          processManager: deps.processManager,
          mechaDir: dir,
          acl: deps.acl,
        }),
      );
    });

    it("reports invalid port", async () => {
      const deps = makeDeps({ mechaDir: dir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "dashboard", "serve", "--port", "abc"]);
      expect(deps.formatter.error).toHaveBeenCalledWith(
        expect.stringContaining("Invalid port"),
      );
      expect(process.exitCode).toBe(1);
      expect(mockCreateAgentServer).not.toHaveBeenCalled();
    });

    it("reports invalid port for out-of-range values", async () => {
      const deps = makeDeps({ mechaDir: dir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "dashboard", "serve", "--port", "99999"]);
      expect(deps.formatter.error).toHaveBeenCalledWith(
        expect.stringContaining("Invalid port"),
      );
      expect(process.exitCode).toBe(1);
    });

    it("errors when --no-totp disables auth", async () => {
      const deps = makeDeps({ mechaDir: dir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "dashboard", "serve", "--no-totp"]);
      expect(deps.formatter.error).toHaveBeenCalledWith(
        expect.stringContaining("TOTP must be enabled"),
      );
      expect(process.exitCode).toBe(1);
    });

    it("errors when SPA not found", async () => {
      const { resolveSpaDir } = await import("../../src/spa-resolve.js");
      vi.mocked(resolveSpaDir).mockResolvedValueOnce(undefined);

      const deps = makeDeps({ mechaDir: dir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "dashboard", "serve"]);
      expect(deps.formatter.error).toHaveBeenCalledWith(
        expect.stringContaining("SPA not found"),
      );
      expect(process.exitCode).toBe(1);
    });
  });
});
