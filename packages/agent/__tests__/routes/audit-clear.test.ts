import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Fastify from "fastify";
import { registerAuditRoutes } from "../../src/routes/audit.js";

describe("POST /audit/clear", () => {
  let mechaDir: string;

  beforeEach(() => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-audit-clear-"));
  });

  afterEach(() => {
    rmSync(mechaDir, { recursive: true, force: true });
  });

  it("clears the audit log file", async () => {
    // Seed an audit entry
    const entry = JSON.stringify({
      ts: new Date().toISOString(),
      client: "test",
      tool: "ping",
      params: {},
      result: "ok",
      durationMs: 1,
    });
    writeFileSync(join(mechaDir, "audit.jsonl"), entry + "\n");

    const app = Fastify();
    registerAuditRoutes(app, { mechaDir });
    await app.ready();

    // Verify entry exists
    const before = await app.inject({ method: "GET", url: "/audit" });
    expect(before.json()).toHaveLength(1);

    // Clear
    const res = await app.inject({ method: "POST", url: "/audit/clear" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    // Verify empty
    const after = await app.inject({ method: "GET", url: "/audit" });
    expect(after.json()).toHaveLength(0);

    // Verify file is empty on disk
    const content = readFileSync(join(mechaDir, "audit.jsonl"), "utf-8");
    expect(content).toBe("");

    await app.close();
  });

  it("succeeds even when no audit file exists", async () => {
    const app = Fastify();
    registerAuditRoutes(app, { mechaDir });
    await app.ready();

    const res = await app.inject({ method: "POST", url: "/audit/clear" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    await app.close();
  });
});
