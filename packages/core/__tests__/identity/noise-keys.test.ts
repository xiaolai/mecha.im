import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { generateNoiseKeyPair, createNoiseKeys, loadNoiseKeyPair, loadNoisePublicKey } from "../../src/identity/noise-keys.js";
import { IDENTITY_DIR } from "../../src/constants.js";

describe("noise-keys", () => {
  let tempDir: string;
  let mechaDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-noise-"));
    mechaDir = join(tempDir, ".mecha");
  });
  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("generateNoiseKeyPair", () => {
    it("generates a valid X25519 keypair", () => {
      const kp = generateNoiseKeyPair();
      expect(typeof kp.publicKey).toBe("string");
      expect(typeof kp.privateKey).toBe("string");
      // base64url strings should be non-empty
      expect(kp.publicKey.length).toBeGreaterThan(10);
      expect(kp.privateKey.length).toBeGreaterThan(10);
    });

    it("generates unique keypairs each time", () => {
      const kp1 = generateNoiseKeyPair();
      const kp2 = generateNoiseKeyPair();
      expect(kp1.publicKey).not.toBe(kp2.publicKey);
      expect(kp1.privateKey).not.toBe(kp2.privateKey);
    });
  });

  describe("createNoiseKeys", () => {
    it("creates noise key files in identity directory", () => {
      const kp = createNoiseKeys(mechaDir);
      expect(kp.publicKey.length).toBeGreaterThan(10);
      expect(kp.privateKey.length).toBeGreaterThan(10);

      const identityDir = join(mechaDir, IDENTITY_DIR);
      expect(existsSync(join(identityDir, "noise.pub"))).toBe(true);
      expect(existsSync(join(identityDir, "noise.key"))).toBe(true);
    });

    it("is idempotent — returns same keys on second call", () => {
      const kp1 = createNoiseKeys(mechaDir);
      const kp2 = createNoiseKeys(mechaDir);
      expect(kp1.publicKey).toBe(kp2.publicKey);
      expect(kp1.privateKey).toBe(kp2.privateKey);
    });
  });

  describe("loadNoiseKeyPair", () => {
    it("returns undefined when keys do not exist", () => {
      mkdirSync(mechaDir, { recursive: true });
      expect(loadNoiseKeyPair(mechaDir)).toBeUndefined();
    });

    it("loads keys after creation", () => {
      const created = createNoiseKeys(mechaDir);
      const loaded = loadNoiseKeyPair(mechaDir);
      expect(loaded).toBeDefined();
      expect(loaded!.publicKey).toBe(created.publicKey);
      expect(loaded!.privateKey).toBe(created.privateKey);
    });
  });

  describe("loadNoisePublicKey", () => {
    it("returns undefined when key does not exist", () => {
      mkdirSync(mechaDir, { recursive: true });
      expect(loadNoisePublicKey(mechaDir)).toBeUndefined();
    });

    it("loads public key after creation", () => {
      const created = createNoiseKeys(mechaDir);
      const pubKey = loadNoisePublicKey(mechaDir);
      expect(pubKey).toBe(created.publicKey);
    });
  });
});
