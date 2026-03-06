import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Fastify from "fastify";
import type { ProcessManager } from "@mecha/process";
import { registerHealthRoutes } from "../../src/routes/health.js";

describe("GET /doctor", () => {
  let mechaDir: string;

  beforeEach(() => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-test-"));
    mkdirSync(join(mechaDir, "meter"), { recursive: true });
  });

  afterEach(() => {
    rmSync(mechaDir, { recursive: true, force: true });
  });

  it("returns doctor checks with healthy flag", async () => {
    const pm = { list: () => [] } as unknown as ProcessManager;
    const app = Fastify();
    registerHealthRoutes(app, {
      nodeName: "test",
      port: 7660,
      processManager: pm,
      startedAt: new Date().toISOString(),
      mechaDir,
    });
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/doctor" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.checks).toBeInstanceOf(Array);
    expect(body.checks.length).toBeGreaterThan(0);
    expect(typeof body.healthy).toBe("boolean");
    await app.close();
  });

  it("works without mechaDir option (falls back to empty string)", async () => {
    const pm = { list: () => [] } as unknown as ProcessManager;
    const app = Fastify();
    registerHealthRoutes(app, {
      nodeName: "test",
      port: 7660,
      processManager: pm,
      startedAt: new Date().toISOString(),
    });
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/doctor" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.checks).toBeInstanceOf(Array);
    // Without a valid mechaDir, mecha-dir check should be "error"
    const mechaDirCheck = body.checks.find((c: { name: string }) => c.name === "mecha-dir");
    expect(mechaDirCheck?.status).toBe("error");
    await app.close();
  });
});
