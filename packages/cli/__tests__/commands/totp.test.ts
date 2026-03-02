import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { makeDeps } from "../test-utils.js";
import { executeTotpSetup, executeTotpVerify, executeTotpStatus } from "../../src/commands/totp.js";

describe("totp commands", () => {
  let dir: string;

  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "totp-cli-")); });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe("executeTotpSetup", () => {
    it("generates and stores TOTP secret", async () => {
      const deps = makeDeps({ mechaDir: dir });
      await executeTotpSetup(deps);
      expect(deps.formatter.success).toHaveBeenCalledWith(
        expect.stringContaining("TOTP secret generated"),
      );
      const stored = readFileSync(join(dir, "totp-secret"), "utf-8").trim();
      expect(stored.length).toBeGreaterThan(10);
    });

    it("warns when secret already exists (no --force)", async () => {
      writeFileSync(join(dir, "totp-secret"), "EXISTING\n");
      const deps = makeDeps({ mechaDir: dir });
      await executeTotpSetup(deps);
      expect(deps.formatter.warn).toHaveBeenCalledWith(
        expect.stringContaining("already exists"),
      );
      // Secret should NOT be overwritten
      expect(readFileSync(join(dir, "totp-secret"), "utf-8").trim()).toBe("EXISTING");
    });

    it("overwrites existing secret with --force", async () => {
      writeFileSync(join(dir, "totp-secret"), "OLD_SECRET\n");
      const deps = makeDeps({ mechaDir: dir });
      await executeTotpSetup(deps, true);
      expect(deps.formatter.success).toHaveBeenCalledWith(
        expect.stringContaining("TOTP secret generated"),
      );
      const stored = readFileSync(join(dir, "totp-secret"), "utf-8").trim();
      expect(stored).not.toBe("OLD_SECRET");
    });
  });

  describe("executeTotpVerify", () => {
    it("errors when no secret configured", async () => {
      const deps = makeDeps({ mechaDir: dir });
      await executeTotpVerify("123456", deps);
      expect(deps.formatter.error).toHaveBeenCalledWith(
        expect.stringContaining("No TOTP secret"),
      );
      expect(process.exitCode).toBe(1);
    });

    it("reports valid code", async () => {
      // Write a known secret and generate a valid code
      const { TOTP, Secret } = await import("otpauth");
      const secret = new Secret({ size: 20 });
      writeFileSync(join(dir, "totp-secret"), secret.base32 + "\n");

      const totp = new TOTP({
        issuer: "mecha",
        label: "agent",
        algorithm: "SHA1",
        digits: 6,
        period: 30,
        secret,
      });
      const code = totp.generate();

      const deps = makeDeps({ mechaDir: dir });
      await executeTotpVerify(code, deps);
      expect(deps.formatter.success).toHaveBeenCalledWith("Valid");
    });

    it("reports invalid code", async () => {
      writeFileSync(join(dir, "totp-secret"), "JBSWY3DPEHPK3PXP\n");
      const deps = makeDeps({ mechaDir: dir });
      await executeTotpVerify("000000", deps);
      expect(deps.formatter.error).toHaveBeenCalledWith("Invalid");
      expect(process.exitCode).toBe(1);
    });
  });

  describe("executeTotpStatus", () => {
    it("reports configured when secret exists", () => {
      writeFileSync(join(dir, "totp-secret"), "JBSWY3DPEHPK3PXP\n");
      const deps = makeDeps({ mechaDir: dir });
      executeTotpStatus(deps);
      expect(deps.formatter.success).toHaveBeenCalledWith("TOTP is configured");
    });

    it("reports not configured when no secret", () => {
      const deps = makeDeps({ mechaDir: dir });
      executeTotpStatus(deps);
      expect(deps.formatter.info).toHaveBeenCalledWith(
        expect.stringContaining("not configured"),
      );
    });
  });
});
