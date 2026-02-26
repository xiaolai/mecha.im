import { describe, it, expect } from "vitest";
import { createNoiseCipher } from "../src/noise.js";
import { randomBytes } from "node:crypto";

describe("noise", () => {
  describe("createNoiseCipher", () => {
    it("encrypts and decrypts round-trip", () => {
      const secret = randomBytes(32);
      const cipher = createNoiseCipher(new Uint8Array(secret));

      const plaintext = new TextEncoder().encode("hello world");
      const encrypted = cipher.encrypt(plaintext);

      // Encrypted should be larger (IV + tag + ciphertext)
      expect(encrypted.length).toBeGreaterThan(plaintext.length);
      // Encrypted should differ from plaintext
      expect(Buffer.from(encrypted).toString("hex")).not.toBe(Buffer.from(plaintext).toString("hex"));

      const decrypted = cipher.decrypt(encrypted);
      expect(new TextDecoder().decode(decrypted)).toBe("hello world");
    });

    it("produces different ciphertext for same plaintext (nonce increment)", () => {
      const secret = randomBytes(32);
      const cipher = createNoiseCipher(new Uint8Array(secret));

      const plaintext = new TextEncoder().encode("same data");
      const enc1 = cipher.encrypt(plaintext);
      const enc2 = cipher.encrypt(plaintext);

      expect(Buffer.from(enc1).toString("hex")).not.toBe(Buffer.from(enc2).toString("hex"));
    });

    it("throws on too-short ciphertext", () => {
      const secret = randomBytes(32);
      const cipher = createNoiseCipher(new Uint8Array(secret));

      expect(() => cipher.decrypt(new Uint8Array(10))).toThrow("Ciphertext too short");
    });

    it("throws on tampered ciphertext", () => {
      const secret = randomBytes(32);
      const cipher = createNoiseCipher(new Uint8Array(secret));

      const plaintext = new TextEncoder().encode("sensitive");
      const encrypted = cipher.encrypt(plaintext);

      // Tamper with the ciphertext portion
      const tampered = new Uint8Array(encrypted);
      tampered[30] = (tampered[30]! ^ 0xff);

      expect(() => cipher.decrypt(tampered)).toThrow();
    });

    it("rekey resets encryption state", () => {
      const secret = randomBytes(32);
      const cipher = createNoiseCipher(new Uint8Array(secret));

      // Encrypt something before rekey
      const enc1 = cipher.encrypt(new TextEncoder().encode("before"));

      cipher.rekey();

      // After rekey, new encryptions use new key
      const enc2 = cipher.encrypt(new TextEncoder().encode("after"));
      expect(enc2.length).toBeGreaterThan(0);

      // Old ciphertext can't be decrypted with new key
      expect(() => cipher.decrypt(enc1)).toThrow();
    });

    it("handles empty plaintext", () => {
      const secret = randomBytes(32);
      const cipher = createNoiseCipher(new Uint8Array(secret));

      const encrypted = cipher.encrypt(new Uint8Array(0));
      // Should still have IV + tag
      expect(encrypted.length).toBe(28);

      const decrypted = cipher.decrypt(encrypted);
      expect(decrypted.length).toBe(0);
    });

    it("handles large payloads", () => {
      const secret = randomBytes(32);
      const cipher = createNoiseCipher(new Uint8Array(secret));

      const large = randomBytes(65536);
      const encrypted = cipher.encrypt(new Uint8Array(large));
      const decrypted = cipher.decrypt(encrypted);

      expect(Buffer.from(decrypted).equals(large)).toBe(true);
    });
  });
});
