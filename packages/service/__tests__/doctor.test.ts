import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mechaDoctor } from "../src/doctor.js";
import type { AuthProfileStore, AuthCredentialStore } from "@mecha/core";

describe("mechaDoctor", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  /** Create a mechaDir with optional auth profiles. */
  function setupMechaDir(opts?: { withProfiles?: boolean }): string {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-doctor-test-"));
    const mechaDir = join(tempDir, ".mecha");
    mkdirSync(mechaDir, { recursive: true });
    mkdirSync(join(mechaDir, "auth"));
    mkdirSync(join(mechaDir, "tools"));
    mkdirSync(join(mechaDir, "logs"));
    writeFileSync(join(mechaDir, "node-id"), "test-id\n");

    if (opts?.withProfiles) {
      const profiles: AuthProfileStore = {
        default: "personal",
        profiles: {
          personal: {
            type: "oauth",
            account: "user@example.com",
            label: "Personal",
            tags: [],
            expiresAt: null,
            createdAt: "2026-02-26T00:00:00Z",
          },
        },
      };
      const creds: AuthCredentialStore = {
        personal: { token: "sk-ant-oat01-test" },
      };
      writeFileSync(join(mechaDir, "auth", "profiles.json"), JSON.stringify(profiles));
      writeFileSync(join(mechaDir, "auth", "credentials.json"), JSON.stringify(creds));
    }

    return mechaDir;
  }

  it("reports error when mecha dir missing", () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-doctor-test-"));
    const mechaDir = join(tempDir, ".mecha");

    const result = mechaDoctor(mechaDir);
    expect(result.healthy).toBe(false);
    const dirCheck = result.checks.find((c) => c.name === "mecha-dir");
    expect(dirCheck?.status).toBe("error");
  });

  it("reports healthy when fully initialized with auth profiles", () => {
    const mechaDir = setupMechaDir({ withProfiles: true });

    const result = mechaDoctor(mechaDir);
    expect(result.healthy).toBe(true);
    expect(result.checks.every((c) => c.status === "ok")).toBe(true);
  });

  it("reports error for missing auth profiles", () => {
    const mechaDir = setupMechaDir();

    const result = mechaDoctor(mechaDir);
    const authCheck = result.checks.find((c) => c.name === "auth-profiles");
    expect(authCheck?.status).toBe("error");
    expect(authCheck?.message).toContain("No auth profiles");
  });

  it("lists each auth profile as ok check", () => {
    const mechaDir = setupMechaDir({ withProfiles: true });

    const result = mechaDoctor(mechaDir);
    const authPersonal = result.checks.find((c) => c.name === "auth:personal");
    expect(authPersonal?.status).toBe("ok");
    expect(authPersonal?.message).toContain("oauth");
    expect(authPersonal?.message).toContain("user@example.com");
    expect(authPersonal?.message).toContain("[default]");
  });

  it("reports warnings for missing subdirectories", () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-doctor-test-"));
    const mechaDir = join(tempDir, ".mecha");
    mkdirSync(mechaDir, { recursive: true });

    const result = mechaDoctor(mechaDir);
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
