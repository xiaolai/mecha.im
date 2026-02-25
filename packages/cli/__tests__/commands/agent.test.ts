import { describe, it, expect, vi, afterEach } from "vitest";
import { createProgram } from "../../src/program.js";
import { makeDeps } from "../test-utils.js";

vi.mock("@mecha/agent", () => ({
  createAgentServer: vi.fn().mockReturnValue({
    listen: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("@mecha/service", async (importOriginal) => {
  const orig = await importOriginal<Record<string, unknown>>();
  return { ...orig, readNodeName: vi.fn().mockReturnValue("test-node") };
});

describe("agent commands", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  describe("agent start", () => {
    it("starts the agent server with defaults", async () => {
      const deps = makeDeps();
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "agent", "start", "--api-key", "test-key"]);
      expect(deps.formatter.success).toHaveBeenCalledWith(
        expect.stringContaining("Agent server started on port"),
      );
    });

    it("uses custom port", async () => {
      const deps = makeDeps();
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "agent", "start", "--port", "9999", "--api-key", "k"]);
      expect(deps.formatter.success).toHaveBeenCalledWith(
        expect.stringContaining("port 9999"),
      );
    });

    it("errors when api key not provided", async () => {
      const deps = makeDeps();
      const program = createProgram(deps);
      program.exitOverride();

      await expect(
        program.parseAsync(["node", "mecha", "agent", "start"]),
      ).rejects.toThrow();
    });

    it("errors when api key is empty/whitespace", async () => {
      const deps = makeDeps();
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "agent", "start", "--api-key", "   "]);
      expect(deps.formatter.error).toHaveBeenCalledWith(
        expect.stringContaining("API key must not be empty"),
      );
    });

    it("reports invalid port", async () => {
      const deps = makeDeps();
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "agent", "start", "--api-key", "k", "--port", "abc"]);
      expect(deps.formatter.error).toHaveBeenCalledWith(
        expect.stringContaining("Invalid port"),
      );
    });

    it("falls back to unknown node name when not initialized", async () => {
      const { readNodeName } = await import("@mecha/service");
      vi.mocked(readNodeName).mockReturnValue(undefined);

      const deps = makeDeps();
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "agent", "start", "--api-key", "k"]);
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
    });
  });
});
