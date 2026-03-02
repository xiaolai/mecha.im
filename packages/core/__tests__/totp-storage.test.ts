import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { mkdtempSync, readFileSync, statSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readTotpSecret, writeTotpSecret, generateTotpSecret, ensureTotpSecret } from "../src/totp-storage.js";

describe("totp-storage", () => {
  let dir: string;

  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "totp-")); });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  describe("readTotpSecret", () => {
    it("returns null when no file and no env", () => {
      expect(readTotpSecret(dir)).toBeNull();
    });

    it("reads secret from file", () => {
      writeFileSync(join(dir, "totp-secret"), "JBSWY3DPEHPK3PXP\n");
      expect(readTotpSecret(dir)).toBe("JBSWY3DPEHPK3PXP");
    });

    it("falls back to MECHA_OTP env var", () => {
      vi.stubEnv("MECHA_OTP", "ENVSECRET");
      expect(readTotpSecret(dir)).toBe("ENVSECRET");
    });

    it("prefers file over env", () => {
      writeFileSync(join(dir, "totp-secret"), "FILESECRET\n");
      vi.stubEnv("MECHA_OTP", "ENVSECRET");
      expect(readTotpSecret(dir)).toBe("FILESECRET");
    });

    it("returns null for empty file and no env", () => {
      writeFileSync(join(dir, "totp-secret"), "  \n");
      expect(readTotpSecret(dir)).toBeNull();
    });
  });

  describe("writeTotpSecret", () => {
    it("writes secret to file with mode 0o600", () => {
      writeTotpSecret(dir, "MYSECRET");
      const content = readFileSync(join(dir, "totp-secret"), "utf-8");
      expect(content.trim()).toBe("MYSECRET");
      const stat = statSync(join(dir, "totp-secret"));
      expect(stat.mode & 0o777).toBe(0o600);
    });

    it("creates parent directory if needed", () => {
      const nested = join(dir, "nested", "dir");
      writeTotpSecret(nested, "DEEP");
      expect(readFileSync(join(nested, "totp-secret"), "utf-8").trim()).toBe("DEEP");
    });
  });

  describe("generateTotpSecret", () => {
    it("returns a base32 string", async () => {
      const secret = await generateTotpSecret();
      expect(secret).toMatch(/^[A-Z2-7]+=*$/);
      expect(secret.length).toBeGreaterThan(10);
    });
  });

  describe("ensureTotpSecret", () => {
    it("generates and stores new secret when none exists", async () => {
      const { secret, isNew } = await ensureTotpSecret(dir);
      expect(isNew).toBe(true);
      expect(secret.length).toBeGreaterThan(10);
      // Verify it was persisted
      const stored = readFileSync(join(dir, "totp-secret"), "utf-8").trim();
      expect(stored).toBe(secret);
    });

    it("returns existing secret without regenerating", async () => {
      writeFileSync(join(dir, "totp-secret"), "EXISTING\n");
      const { secret, isNew } = await ensureTotpSecret(dir);
      expect(isNew).toBe(false);
      expect(secret).toBe("EXISTING");
    });
  });
});
