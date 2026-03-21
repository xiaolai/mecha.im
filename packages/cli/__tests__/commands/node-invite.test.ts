import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createProgram } from "../../src/program.js";
import { makeDeps } from "../test-utils.js";
import { createNodeIdentity } from "@mecha/core";
import { nodeInit } from "@mecha/service";

describe("node invite command", () => {
  let tempDir: string;
  let mechaDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-invite-"));
    mechaDir = join(tempDir, ".mecha");
    // Mock fetch for server registration (best-effort)
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 201 }),
    );
  });
  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("creates an invite code", async () => {
    createNodeIdentity(mechaDir);
    nodeInit(mechaDir, { name: "test-node" });

    const deps = makeDeps({ mechaDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "node", "invite"]);

    expect(deps.formatter.success).toHaveBeenCalledWith(
      expect.stringContaining("mecha://invite/"),
    );
    expect(deps.formatter.info).toHaveBeenCalledWith(
      expect.stringContaining("Expires:"),
    );
  });

  it("registers invite on server", async () => {
    createNodeIdentity(mechaDir);
    nodeInit(mechaDir, { name: "test-node" });

    const deps = makeDeps({ mechaDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "node", "invite"]);

    // Verify fetch was called with POST /invite
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/invite"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("warns when server registration fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("error", { status: 500 }),
    );

    createNodeIdentity(mechaDir);
    nodeInit(mechaDir, { name: "test-node" });

    const deps = makeDeps({ mechaDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "node", "invite"]);

    expect(deps.formatter.warn).toHaveBeenCalledWith(
      expect.stringContaining("Server registration failed"),
    );
    // Invite code should still be output
    expect(deps.formatter.success).toHaveBeenCalledWith(
      expect.stringContaining("mecha://invite/"),
    );
  });

  it("accepts custom expiry", async () => {
    createNodeIdentity(mechaDir);
    nodeInit(mechaDir, { name: "test-node" });

    const deps = makeDeps({ mechaDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "node", "invite", "--expires", "1h"]);

    expect(deps.formatter.success).toHaveBeenCalledWith(
      expect.stringContaining("mecha://invite/"),
    );
    expect(deps.formatter.info).toHaveBeenCalledWith(
      expect.stringContaining("1h"),
    );
  });

  it("accepts various duration formats", async () => {
    createNodeIdentity(mechaDir);
    nodeInit(mechaDir, { name: "test-node" });

    for (const duration of ["30s", "5m", "7d"]) {
      const deps = makeDeps({ mechaDir });
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "node", "invite", "--expires", duration]);

      expect(deps.formatter.success).toHaveBeenCalledWith(
        expect.stringContaining("mecha://invite/"),
      );
    }
  });

  it("errors on invalid duration format", async () => {
    createNodeIdentity(mechaDir);
    nodeInit(mechaDir, { name: "test-node" });

    const deps = makeDeps({ mechaDir });
    const program = createProgram(deps);
    program.exitOverride();

    await expect(
      program.parseAsync(["node", "mecha", "node", "invite", "--expires", "invalid"]),
    ).rejects.toThrow("Invalid duration");
  });

  it("uses --server override for rendezvous URL", async () => {
    createNodeIdentity(mechaDir);
    nodeInit(mechaDir, { name: "test-node" });

    const deps = makeDeps({ mechaDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "node", "invite", "--server", "ws://custom:9090"]);

    // Invite code should contain the custom URL
    const inviteCode = (deps.formatter.success as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    const payload = JSON.parse(Buffer.from(inviteCode.replace("mecha://invite/", ""), "base64url").toString());
    expect(payload.rendezvousUrl).toBe("ws://custom:9090");

    // Server registration should use the custom URL
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining("http://custom:9090/invite"),
      expect.anything(),
    );
  });

  it("errors when node name not set", async () => {
    createNodeIdentity(mechaDir);
    // No nodeInit — name is missing

    const deps = makeDeps({ mechaDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "node", "invite"]);

    expect(deps.formatter.error).toHaveBeenCalledWith(
      expect.stringContaining("Identity not found"),
    );
  });

  it("errors when node not initialized", async () => {
    const deps = makeDeps({ mechaDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "node", "invite"]);

    expect(deps.formatter.error).toHaveBeenCalledWith(
      expect.stringContaining("Identity not found"),
    );
  });
});
