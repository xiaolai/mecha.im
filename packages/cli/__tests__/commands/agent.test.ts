import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createProgram } from "../../src/program.js";
import { makeDeps } from "../test-utils.js";

let dir: string;

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "agent-test-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

vi.mock("@mecha/agent", () => ({
  createAgentServer: vi.fn().mockReturnValue({
    listen: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("@mecha/service", async (importOriginal) => {
  const orig = await importOriginal<Record<string, unknown>>();
  return { ...orig, readNodeName: vi.fn().mockReturnValue("test-node") };
});

vi.mock("@mecha/process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mecha/process")>();
  return { ...actual, createBunPtySpawn: vi.fn().mockReturnValue(vi.fn()) };
});

vi.mock("../../src/totp-display.js", () => ({
  displayTotpSetup: vi.fn().mockResolvedValue(undefined),
}));

describe("agent commands", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined as unknown as number;
  });

  describe("agent start", () => {
    it("starts with TOTP by default (auto-generates secret)", async () => {
      const deps = makeDeps({ mechaDir: dir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "agent", "start"]);
      expect(deps.formatter.success).toHaveBeenCalledWith(
        expect.stringContaining("Agent server started on 127.0.0.1:"),
      );
      expect(deps.formatter.success).toHaveBeenCalledWith(
        expect.stringContaining("TOTP"),
      );
    });

    it("uses custom port", async () => {
      const deps = makeDeps({ mechaDir: dir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "agent", "start", "--port", "9999"]);
      expect(deps.formatter.success).toHaveBeenCalledWith(
        expect.stringContaining("127.0.0.1:9999"),
      );
    });

    it("errors when --no-totp disables auth", async () => {
      const deps = makeDeps({ mechaDir: dir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "agent", "start", "--no-totp"]);
      expect(deps.formatter.error).toHaveBeenCalledWith(
        expect.stringContaining("TOTP must be enabled"),
      );
      expect(process.exitCode).toBe(1);
    });

    it("reports invalid port", async () => {
      const deps = makeDeps({ mechaDir: dir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "agent", "start", "--port", "abc"]);
      expect(deps.formatter.error).toHaveBeenCalledWith(
        expect.stringContaining("Invalid port"),
      );
    });

    it("falls back to unknown node name when not initialized", async () => {
      const { readNodeName } = await import("@mecha/service");
      vi.mocked(readNodeName).mockReturnValue(undefined);

      const deps = makeDeps({ mechaDir: dir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "agent", "start"]);
      expect(deps.formatter.success).toHaveBeenCalledWith(
        expect.stringContaining("node: unknown"),
      );
    });
  });

  describe("agent status", () => {
    it("reports running when healthz responds ok", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ status: "ok", node: "alice" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

      const deps = makeDeps();
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "agent", "status", "--port", "7660"]);
      expect(deps.formatter.success).toHaveBeenCalledWith(
        expect.stringContaining("running on port 7660"),
      );
    });

    it("reports invalid port", async () => {
      const deps = makeDeps();
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "agent", "status", "--port", "abc"]);
      expect(deps.formatter.error).toHaveBeenCalledWith(
        expect.stringContaining("Invalid port"),
      );
      expect(process.exitCode).toBe(1);
    });

    it("reports not reachable when fetch fails", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));

      const deps = makeDeps();
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "agent", "status", "--port", "7660"]);
      expect(deps.formatter.error).toHaveBeenCalledWith(
        expect.stringContaining("not reachable"),
      );
      expect(process.exitCode).toBe(1);
    });

    it("reports error when healthz returns non-OK", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 500 }));

      const deps = makeDeps();
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "agent", "status", "--port", "7660"]);
      expect(deps.formatter.error).toHaveBeenCalledWith(
        expect.stringContaining("HTTP 500"),
      );
      expect(process.exitCode).toBe(1);
    });
  });
});
