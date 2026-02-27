import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readCasaConfig, updateCasaConfig } from "../src/casa-config.js";
import { forwardQueryToCasa } from "../src/forwarding.js";

describe("readCasaConfig", () => {
  let tempDir: string;
  afterEach(() => { if (tempDir) rmSync(tempDir, { recursive: true, force: true }); });

  it("reads valid config", () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cfg-"));
    writeFileSync(join(tempDir, "config.json"), JSON.stringify({
      port: 7700, token: "tok", workspace: "/ws", tags: ["a", "b"],
    }));
    const cfg = readCasaConfig(tempDir);
    expect(cfg).toEqual({
      port: 7700, token: "tok", workspace: "/ws", tags: ["a", "b"],
    });
  });

  it("returns undefined for missing file", () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cfg-"));
    expect(readCasaConfig(tempDir)).toBeUndefined();
  });

  it("returns undefined for malformed JSON", () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cfg-"));
    writeFileSync(join(tempDir, "config.json"), "not-json{{{");
    expect(readCasaConfig(tempDir)).toBeUndefined();
  });

  it("returns undefined for structurally invalid config (missing required fields)", () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cfg-"));
    writeFileSync(join(tempDir, "config.json"), JSON.stringify({ foo: "bar" }));
    expect(readCasaConfig(tempDir)).toBeUndefined();
  });

  it("returns undefined for non-object JSON (null)", () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cfg-"));
    writeFileSync(join(tempDir, "config.json"), "null");
    expect(readCasaConfig(tempDir)).toBeUndefined();
  });

  it("returns undefined for array JSON", () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cfg-"));
    writeFileSync(join(tempDir, "config.json"), "[]");
    expect(readCasaConfig(tempDir)).toBeUndefined();
  });

  it("rejects non-array expose (Zod strict)", () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cfg-"));
    writeFileSync(join(tempDir, "config.json"), JSON.stringify({
      port: 7700, token: "tok", workspace: "/ws", expose: "not-an-array",
    }));
    // Zod rejects non-array expose — config is invalid
    expect(readCasaConfig(tempDir)).toBeUndefined();
  });

  it("reads valid sandboxMode", () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cfg-"));
    writeFileSync(join(tempDir, "config.json"), JSON.stringify({
      port: 7700, token: "tok", workspace: "/ws", sandboxMode: "require",
    }));
    const cfg = readCasaConfig(tempDir);
    expect(cfg!.sandboxMode).toBe("require");
  });

  it("rejects invalid sandboxMode (Zod strict)", () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cfg-"));
    writeFileSync(join(tempDir, "config.json"), JSON.stringify({
      port: 7700, token: "tok", workspace: "/ws", sandboxMode: "invalid",
    }));
    // Zod rejects invalid enum values — config is invalid
    expect(readCasaConfig(tempDir)).toBeUndefined();
  });

  it("rejects non-string entries in expose array (Zod strict)", () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cfg-"));
    writeFileSync(join(tempDir, "config.json"), JSON.stringify({
      port: 7700, token: "tok", workspace: "/ws", expose: ["query", 42, null, "execute"],
    }));
    // Zod rejects mixed-type arrays — config is invalid
    expect(readCasaConfig(tempDir)).toBeUndefined();
  });

  it("rejects non-array tags (Zod strict)", () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cfg-"));
    writeFileSync(join(tempDir, "config.json"), JSON.stringify({
      port: 7700, token: "tok", workspace: "/ws", tags: "not-an-array",
    }));
    // Zod rejects non-array tags — config is invalid
    expect(readCasaConfig(tempDir)).toBeUndefined();
  });
});

describe("updateCasaConfig", () => {
  let tempDir: string;
  afterEach(() => { if (tempDir) rmSync(tempDir, { recursive: true, force: true }); });

  it("merges updates into existing config", () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cfg-"));
    writeFileSync(join(tempDir, "config.json"), JSON.stringify({
      port: 7700, token: "tok", workspace: "/ws",
    }));
    updateCasaConfig(tempDir, { tags: ["x", "y"] });
    const cfg = JSON.parse(readFileSync(join(tempDir, "config.json"), "utf-8"));
    expect(cfg.port).toBe(7700);
    expect(cfg.tags).toEqual(["x", "y"]);
  });

  it("overwrites existing tags", () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cfg-"));
    writeFileSync(join(tempDir, "config.json"), JSON.stringify({
      port: 7700, token: "tok", workspace: "/ws", tags: ["old"],
    }));
    updateCasaConfig(tempDir, { tags: ["new1", "new2"] });
    const cfg = JSON.parse(readFileSync(join(tempDir, "config.json"), "utf-8"));
    expect(cfg.tags).toEqual(["new1", "new2"]);
  });

  it("creates config if missing", () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cfg-"));
    updateCasaConfig(tempDir, { tags: ["a"] });
    const cfg = JSON.parse(readFileSync(join(tempDir, "config.json"), "utf-8"));
    expect(cfg.tags).toEqual(["a"]);
  });
});

describe("forwardQueryToCasa", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("returns ForwardResult on success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ response: "hello" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const result = await forwardQueryToCasa(7700, "tok", "hi");
    expect(result).toEqual({ text: "hello", sessionId: undefined });
    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:7700/api/chat",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("throws on non-OK response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("error", { status: 500 }),
    );
    await expect(forwardQueryToCasa(7700, "tok", "hi")).rejects.toThrow("returned HTTP 500");
  });

  it("sends sessionId when provided", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ response: "continued", sessionId: "sess-abc" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const result = await forwardQueryToCasa(7700, "tok", "hi", "sess-abc");
    expect(result).toEqual({ text: "continued", sessionId: "sess-abc" });

    const call = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse(call[1]!.body as string);
    expect(body.sessionId).toBe("sess-abc");
  });

  it("omits sessionId from body when not provided", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ response: "ok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    await forwardQueryToCasa(7700, "tok", "hi");

    const call = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse(call[1]!.body as string);
    expect(body.sessionId).toBeUndefined();
  });
});
