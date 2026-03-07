import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createProgram } from "../../src/program.js";
import { makeDeps } from "../test-utils.js";
import { addNode } from "@mecha/core";

describe("node health command", () => {
  let tempDir: string;
  let mechaDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cli-health-"));
    mechaDir = join(tempDir, ".mecha");
    mkdirSync(mechaDir, { recursive: true });
  });
  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function addHttpNode(name: string, host = "203.0.113.10"): void {
    addNode(mechaDir, {
      name,
      host,
      port: 7660,
      apiKey: "key",
      addedAt: new Date().toISOString(),
    });
  }

  function addManagedNode(name: string): void {
    addNode(mechaDir, {
      name,
      host: "",
      port: 0,
      apiKey: "",
      publicKey: "pk",
      fingerprint: "fp",
      managed: true,
      addedAt: new Date().toISOString(),
    });
  }

  it("checks specific HTTP node — online with bot count", async () => {
    addHttpNode("bob");

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("ok", { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ name: "c1" }, { name: "c2" }]), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

    const deps = makeDeps({ mechaDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "node", "health", "bob"]);

    expect(deps.formatter.success).toHaveBeenCalledWith(
      expect.stringMatching(/bob: \d+ms — 2 bots running — \(http\)/),
    );
  });

  it("sends the node's actual API key in the Authorization header", async () => {
    addHttpNode("bob");

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("ok", { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

    const deps = makeDeps({ mechaDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "node", "health", "bob"]);

    // Verify the /bots request includes the node's API key (not a placeholder)
    const botsCall = vi.mocked(fetch).mock.calls.find((c) => String(c[0]).includes("/bots"));
    expect(botsCall).toBeDefined();
    const headers = botsCall![1]?.headers as Record<string, string> | undefined;
    expect(headers?.authorization).toBe("Bearer key");
  });

  it("checks specific HTTP node — online without bot count", async () => {
    addHttpNode("bob");

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("ok", { status: 200 }))
      .mockResolvedValueOnce(new Response("err", { status: 500 }));

    const deps = makeDeps({ mechaDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "node", "health", "bob"]);

    expect(deps.formatter.success).toHaveBeenCalledWith(
      expect.stringMatching(/bob: \d+ms — \(http\)/),
    );
  });

  it("checks specific HTTP node — offline (HTTP error)", async () => {
    addHttpNode("bob");

    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("err", { status: 503 }));

    const deps = makeDeps({ mechaDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "node", "health", "bob"]);

    expect(deps.formatter.error).toHaveBeenCalledWith("bob: offline — HTTP 503");
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
  });

  it("checks specific HTTP node — unreachable", async () => {
    addHttpNode("bob");

    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));

    const deps = makeDeps({ mechaDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "node", "health", "bob"]);

    expect(deps.formatter.error).toHaveBeenCalledWith("bob: offline — unreachable");
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
  });

  it("checks specific managed node — online", async () => {
    addManagedNode("charlie");

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ online: true })),
    );

    const deps = makeDeps({ mechaDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "node", "health", "charlie"]);

    expect(deps.formatter.success).toHaveBeenCalledWith(
      expect.stringMatching(/charlie: \d+ms — \(managed\)/),
    );
  });

  it("checks specific managed node — offline (not online)", async () => {
    addManagedNode("charlie");

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ online: false })),
    );

    const deps = makeDeps({ mechaDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "node", "health", "charlie"]);

    expect(deps.formatter.error).toHaveBeenCalledWith("charlie: offline");
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
  });

  it("checks specific managed node — offline (HTTP error)", async () => {
    addManagedNode("charlie");

    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("err", { status: 500 }));

    const deps = makeDeps({ mechaDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "node", "health", "charlie"]);

    expect(deps.formatter.error).toHaveBeenCalledWith("charlie: offline");
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
  });

  it("checks specific managed node — unreachable", async () => {
    addManagedNode("charlie");

    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));

    const deps = makeDeps({ mechaDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "node", "health", "charlie"]);

    expect(deps.formatter.error).toHaveBeenCalledWith("charlie: offline — unreachable");
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
  });

  it("errors for unknown node", async () => {
    const deps = makeDeps({ mechaDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "node", "health", "ghost"]);

    expect(deps.formatter.error).toHaveBeenCalledWith(
      expect.stringContaining("not found"),
    );
  });

  it("checks all nodes when no name given", async () => {
    addHttpNode("alpha");
    addManagedNode("beta");

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/healthz")) return new Response("ok", { status: 200 });
      if (url.includes("/bots")) return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
      if (url.includes("/lookup/")) return new Response(JSON.stringify({ online: true }));
      return new Response("not found", { status: 404 });
    });

    const deps = makeDeps({ mechaDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "node", "health"]);

    expect(deps.formatter.success).toHaveBeenCalledTimes(2);
  });

  it("reports no nodes configured", async () => {
    const deps = makeDeps({ mechaDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "node", "health"]);

    expect(deps.formatter.info).toHaveBeenCalledWith("No remote nodes configured");
  });

  it("checks all nodes — mix of online and offline", async () => {
    addHttpNode("alpha", "10.0.0.1");
    addHttpNode("beta", "10.0.0.2");

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("10.0.0.1") && url.includes("/healthz"))
        return new Response("ok", { status: 200 });
      if (url.includes("10.0.0.1") && url.includes("/bots"))
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      if (url.includes("10.0.0.2"))
        throw new Error("ECONNREFUSED");
      return new Response("not found", { status: 404 });
    });

    const deps = makeDeps({ mechaDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "node", "health"]);

    expect(deps.formatter.success).toHaveBeenCalledTimes(1);
    expect(deps.formatter.error).toHaveBeenCalledTimes(1);
  });

  it("reports offline without error detail in all-nodes mode", async () => {
    addManagedNode("charlie");

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ online: false })),
    );

    const deps = makeDeps({ mechaDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "node", "health"]);

    // No error detail for managed offline node — just "charlie: offline"
    expect(deps.formatter.error).toHaveBeenCalledWith("charlie: offline");
  });

  it("handles bot count fetch error gracefully", async () => {
    addHttpNode("bob");

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("ok", { status: 200 }))
      .mockRejectedValueOnce(new Error("timeout"));

    const deps = makeDeps({ mechaDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "node", "health", "bob"]);

    // Should still report online — bot count is best-effort
    expect(deps.formatter.success).toHaveBeenCalledWith(
      expect.stringMatching(/bob: \d+ms — \(http\)/),
    );
  });
});
