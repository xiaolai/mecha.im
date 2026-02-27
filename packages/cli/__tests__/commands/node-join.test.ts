import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createProgram } from "../../src/program.js";
import { makeDeps } from "../test-utils.js";
import { createNodeIdentity, loadNodePrivateKey, readNodes } from "@mecha/core";
import { createInviteCode } from "@mecha/connect";
import { nodeInit } from "@mecha/service";

async function makeInviteCode(mechaDir: string, nodeName = "inviter-node"): Promise<string> {
  const identity = createNodeIdentity(mechaDir);
  nodeInit(mechaDir, { name: nodeName });
  const privateKey = loadNodePrivateKey(mechaDir)!;
  const result = await createInviteCode({
    identity,
    nodeName,
    noisePublicKey: "test-noise-key",
    privateKey,
    rendezvousUrl: "wss://test.example.com",
    opts: { expiresIn: 3600 },
  });
  return result.code;
}

describe("node join command", () => {
  let tempDir: string;
  let inviterDir: string;
  let joinerDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-join-"));
    inviterDir = join(tempDir, "inviter");
    joinerDir = join(tempDir, "joiner");
    // Mock fetch to simulate server accept (best-effort, may fail)
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ok: true })));
  });
  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("joins with a valid invite code", async () => {
    const code = await makeInviteCode(inviterDir);

    // Initialize joiner
    createNodeIdentity(joinerDir);
    nodeInit(joinerDir, { name: "joiner-node" });

    const deps = makeDeps({ mechaDir: joinerDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "node", "join", code]);

    expect(deps.formatter.success).toHaveBeenCalledWith(
      expect.stringContaining("Peer added"),
    );

    // Verify node was added to registry
    const nodes = readNodes(joinerDir);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.managed).toBe(true);
  });

  it("notifies when server accept succeeds", async () => {
    const code = await makeInviteCode(inviterDir);
    createNodeIdentity(joinerDir);
    nodeInit(joinerDir, { name: "joiner-node" });

    const deps = makeDeps({ mechaDir: joinerDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "node", "join", code]);

    expect(deps.formatter.info).toHaveBeenCalledWith("Invite accepted on server (inviter notified)");
  });

  it("warns when server accept fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("error", { status: 500 }));

    const code = await makeInviteCode(inviterDir);
    createNodeIdentity(joinerDir);
    nodeInit(joinerDir, { name: "joiner-node" });

    const deps = makeDeps({ mechaDir: joinerDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "node", "join", code]);

    expect(deps.formatter.warn).toHaveBeenCalledWith(
      expect.stringContaining("Server accept failed"),
    );
    // Peer should still be added locally
    expect(deps.formatter.success).toHaveBeenCalledWith(
      expect.stringContaining("Peer added"),
    );
  });

  it("rejects invalid invite code", async () => {
    createNodeIdentity(joinerDir);
    nodeInit(joinerDir, { name: "joiner-node" });

    const deps = makeDeps({ mechaDir: joinerDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "node", "join", "https://bad.com/invite"]);

    expect(deps.formatter.error).toHaveBeenCalledWith(
      expect.stringContaining("Expected mecha:// scheme"),
    );
  });

  it("warns on untrusted rendezvous URL scheme", async () => {
    // Create invite with file:// scheme (simulated via mock parseInviteCode)
    // We test the node-join SSRF guard by using a specially crafted invite
    const code = await makeInviteCode(inviterDir);
    createNodeIdentity(joinerDir);
    nodeInit(joinerDir, { name: "joiner-node" });

    // Mock parseInviteCode to return a payload with untrusted scheme
    const connectMod = await import("@mecha/connect");
    const originalParse = connectMod.parseInviteCode;
    const parseSpy = vi.spyOn(connectMod, "parseInviteCode").mockImplementation((c: string) => {
      const payload = originalParse(c);
      return { ...payload, rendezvousUrl: "file:///etc/passwd" };
    });

    const deps = makeDeps({ mechaDir: joinerDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "node", "join", code]);

    expect(deps.formatter.warn).toHaveBeenCalledWith(
      "Could not reach any rendezvous server — peer added locally",
    );
    // Peer should still be added locally
    expect(deps.formatter.success).toHaveBeenCalledWith(
      expect.stringContaining("Peer added"),
    );

    parseSpy.mockRestore();
  });

  it("rejects expired invite", async () => {
    const identity = createNodeIdentity(inviterDir);
    nodeInit(inviterDir, { name: "expired-inviter" });
    const privateKey = loadNodePrivateKey(inviterDir)!;
    const result = await createInviteCode({
      client: undefined as never,
      identity,
      nodeName: "expired-inviter",
      noisePublicKey: "key",
      privateKey,
      opts: { expiresIn: -1 },
    });

    createNodeIdentity(joinerDir);
    nodeInit(joinerDir, { name: "joiner-node" });

    const deps = makeDeps({ mechaDir: joinerDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "node", "join", result.code]);

    expect(deps.formatter.error).toHaveBeenCalledWith(
      expect.stringContaining("Invite expired"),
    );
  });

  it("errors when node not initialized", async () => {
    const code = await makeInviteCode(inviterDir);

    const deps = makeDeps({ mechaDir: joinerDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "node", "join", code]);

    expect(deps.formatter.error).toHaveBeenCalledWith(
      expect.stringContaining("Identity not found"),
    );
  });

  it("errors when node name not set", async () => {
    const code = await makeInviteCode(inviterDir);
    createNodeIdentity(joinerDir);
    // No nodeInit — name is missing

    const deps = makeDeps({ mechaDir: joinerDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "node", "join", code]);

    expect(deps.formatter.error).toHaveBeenCalledWith(
      expect.stringContaining("Identity not found"),
    );
  });

  it("rejects self-invite", async () => {
    // Create identity for joiner
    const identity = createNodeIdentity(joinerDir);
    const privateKey = loadNodePrivateKey(joinerDir)!;
    nodeInit(joinerDir, { name: "my-node" });

    // Create an invite FROM the joiner's own identity
    const result = await createInviteCode({
      client: undefined as never,
      identity,
      nodeName: "my-node",
      noisePublicKey: "test-noise-key",
      privateKey,
      rendezvousUrl: "wss://test.example.com",
      opts: { expiresIn: 3600 },
    });

    const deps = makeDeps({ mechaDir: joinerDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "node", "join", result.code]);

    expect(deps.formatter.error).toHaveBeenCalledWith("Cannot accept own invite");
  });

  it("allows duplicate peer with --force", async () => {
    const code = await makeInviteCode(inviterDir);
    createNodeIdentity(joinerDir);
    nodeInit(joinerDir, { name: "joiner-node" });

    const deps = makeDeps({ mechaDir: joinerDir });
    const program = createProgram(deps);
    program.exitOverride();

    // First join
    await program.parseAsync(["node", "mecha", "node", "join", code]);
    expect(deps.formatter.success).toHaveBeenCalled();

    // Second join with --force
    const code2 = await makeInviteCode(inviterDir);
    await program.parseAsync(["node", "mecha", "node", "join", "--force", code2]);
    expect(deps.formatter.success).toHaveBeenCalledTimes(2);

    // Should still have only one node
    const nodes = readNodes(joinerDir);
    expect(nodes).toHaveLength(1);
  });

  it("rejects duplicate peer without --force", async () => {
    const code = await makeInviteCode(inviterDir);
    createNodeIdentity(joinerDir);
    nodeInit(joinerDir, { name: "joiner-node" });

    const deps = makeDeps({ mechaDir: joinerDir });
    const program = createProgram(deps);
    program.exitOverride();

    // First join
    await program.parseAsync(["node", "mecha", "node", "join", code]);
    expect(deps.formatter.success).toHaveBeenCalled();

    // Create a new invite (same inviter)
    const code2 = await makeInviteCode(inviterDir);

    // Second join — should fail
    await program.parseAsync(["node", "mecha", "node", "join", code2]);
    expect(deps.formatter.error).toHaveBeenCalledWith(
      expect.stringContaining("already registered"),
    );
  });
});
