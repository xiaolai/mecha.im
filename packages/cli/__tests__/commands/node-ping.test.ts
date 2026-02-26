import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createProgram } from "../../src/program.js";
import { makeDeps } from "../test-utils.js";
import { addNode } from "@mecha/core";

describe("node ping command", () => {
  let tempDir: string;
  let mechaDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-ping-"));
    mechaDir = join(tempDir, ".mecha");
    mkdirSync(mechaDir, { recursive: true });
  });
  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("pings an HTTP node successfully", async () => {
    addNode(mechaDir, {
      name: "bob",
      host: "203.0.113.10",
      port: 7660,
      apiKey: "key",
      addedAt: new Date().toISOString(),
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));

    const deps = makeDeps({ mechaDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "node", "ping", "bob"]);

    expect(deps.formatter.success).toHaveBeenCalledWith(
      expect.stringMatching(/bob: \d+ms \(http\)/),
    );
  });

  it("reports HTTP error status", async () => {
    addNode(mechaDir, {
      name: "bob",
      host: "203.0.113.10",
      port: 7660,
      apiKey: "key",
      addedAt: new Date().toISOString(),
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("error", { status: 500 }));

    const deps = makeDeps({ mechaDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "node", "ping", "bob"]);

    expect(deps.formatter.error).toHaveBeenCalledWith("bob: HTTP 500");
  });

  it("reports unreachable HTTP node", async () => {
    addNode(mechaDir, {
      name: "bob",
      host: "203.0.113.10",
      port: 7660,
      apiKey: "key",
      addedAt: new Date().toISOString(),
    });

    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));

    const deps = makeDeps({ mechaDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "node", "ping", "bob"]);

    expect(deps.formatter.error).toHaveBeenCalledWith("bob: unreachable");
  });

  it("shows info for managed node", async () => {
    addNode(mechaDir, {
      name: "charlie",
      host: "",
      port: 0,
      apiKey: "",
      publicKey: "pk",
      fingerprint: "fp",
      managed: true,
      addedAt: new Date().toISOString(),
    });

    const deps = makeDeps({ mechaDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "node", "ping", "charlie"]);

    expect(deps.formatter.info).toHaveBeenCalledWith(
      expect.stringContaining("managed node"),
    );
  });

  it("errors for unknown node", async () => {
    const deps = makeDeps({ mechaDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "node", "ping", "ghost"]);

    expect(deps.formatter.error).toHaveBeenCalledWith(
      expect.stringContaining("not found"),
    );
  });
});
