import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mechaDoctor } from "../src/doctor.js";

describe("mechaDoctor", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it("reports error when mecha dir missing", () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-doctor-test-"));
    const mechaDir = join(tempDir, ".mecha");

    const result = mechaDoctor(mechaDir);
    expect(result.healthy).toBe(false);
    const dirCheck = result.checks.find((c) => c.name === "mecha-dir");
    expect(dirCheck?.status).toBe("error");
  });

  it("reports healthy when fully initialized", () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-doctor-test-"));
    const mechaDir = join(tempDir, ".mecha");
    mkdirSync(mechaDir, { recursive: true });
    mkdirSync(join(mechaDir, "casas"));
    mkdirSync(join(mechaDir, "auth"));
    mkdirSync(join(mechaDir, "tools"));
    mkdirSync(join(mechaDir, "logs"));
    writeFileSync(join(mechaDir, "node-id"), "test-id\n");

    const result = mechaDoctor(mechaDir);
    expect(result.healthy).toBe(true);
    expect(result.checks.every((c) => c.status === "ok")).toBe(true);
  });

  it("reports warnings for missing subdirectories", () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-doctor-test-"));
    const mechaDir = join(tempDir, ".mecha");
    mkdirSync(mechaDir, { recursive: true });

    const result = mechaDoctor(mechaDir);
    expect(result.healthy).toBe(true); // warnings don't make it unhealthy
    const warnings = result.checks.filter((c) => c.status === "warn");
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("reports warning for missing node-id", () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-doctor-test-"));
    const mechaDir = join(tempDir, ".mecha");
    mkdirSync(mechaDir, { recursive: true });

    const result = mechaDoctor(mechaDir);
    const nodeIdCheck = result.checks.find((c) => c.name === "node-id");
    expect(nodeIdCheck?.status).toBe("warn");
  });
});
