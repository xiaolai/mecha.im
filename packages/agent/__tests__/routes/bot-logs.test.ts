import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Fastify from "fastify";
import { registerBotRoutes } from "../../src/routes/bots.js";
import { makePm } from "../../../service/__tests__/test-utils.js";

vi.mock("@mecha/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mecha/service")>();
  return {
    ...actual,
    getCachedSnapshot: vi.fn().mockReturnValue(null),
    checkBotBusy: vi.fn().mockResolvedValue({ busy: false, activeSessions: 0 }),
  };
});

describe("GET /bots/:name/logs", () => {
  let mechaDir: string;

  beforeEach(() => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-test-"));
  });

  afterEach(() => {
    rmSync(mechaDir, { recursive: true, force: true });
  });

  it("returns last N lines of stdout", async () => {
    const botDir = join(mechaDir, "alice");
    mkdirSync(join(botDir, "logs"), { recursive: true });
    const logLines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
    writeFileSync(join(botDir, "logs", "stdout.log"), logLines.join("\n"));

    const app = Fastify();
    registerBotRoutes(app, makePm([]), mechaDir);
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/bots/alice/logs?lines=10" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.lines).toHaveLength(10);
    expect(body.lines[0]).toBe("line 11");
    expect(body.lines[9]).toBe("line 20");
    await app.close();
  });

  it("defaults to stdout when stream not specified", async () => {
    const botDir = join(mechaDir, "alice");
    mkdirSync(join(botDir, "logs"), { recursive: true });
    writeFileSync(join(botDir, "logs", "stdout.log"), "stdout-line\n");

    const app = Fastify();
    registerBotRoutes(app, makePm([]), mechaDir);
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/bots/alice/logs" });
    expect(res.statusCode).toBe(200);
    expect(res.json().lines).toEqual(["stdout-line"]);
    await app.close();
  });

  it("returns stderr when requested", async () => {
    const botDir = join(mechaDir, "alice");
    mkdirSync(join(botDir, "logs"), { recursive: true });
    writeFileSync(join(botDir, "logs", "stderr.log"), "error-line\n");

    const app = Fastify();
    registerBotRoutes(app, makePm([]), mechaDir);
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/bots/alice/logs?stream=stderr" });
    expect(res.statusCode).toBe(200);
    expect(res.json().lines).toEqual(["error-line"]);
    await app.close();
  });

  it("returns 404 when bot dir does not exist", async () => {
    const app = Fastify();
    registerBotRoutes(app, makePm([]), mechaDir);
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/bots/nonexistent/logs" });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("returns empty array when log file does not exist", async () => {
    const botDir = join(mechaDir, "alice");
    mkdirSync(botDir, { recursive: true });

    const app = Fastify();
    registerBotRoutes(app, makePm([]), mechaDir);
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/bots/alice/logs" });
    expect(res.statusCode).toBe(200);
    expect(res.json().lines).toEqual([]);
    await app.close();
  });

  it("caps lines at 5000", async () => {
    const botDir = join(mechaDir, "alice");
    mkdirSync(join(botDir, "logs"), { recursive: true });
    const logLines = Array.from({ length: 10000 }, (_, i) => `line ${i}`);
    writeFileSync(join(botDir, "logs", "stdout.log"), logLines.join("\n"));

    const app = Fastify();
    registerBotRoutes(app, makePm([]), mechaDir);
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/bots/alice/logs?lines=99999" });
    expect(res.statusCode).toBe(200);
    expect(res.json().lines.length).toBeLessThanOrEqual(5000);
    await app.close();
  });
});
