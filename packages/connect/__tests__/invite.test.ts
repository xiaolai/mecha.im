import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createInviteCode, parseInviteCode } from "../src/invite.js";
import { createNodeIdentity, loadNodePrivateKey, InvalidInviteError } from "@mecha/core";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { RendezvousClient } from "../src/types.js";

function makeMockRendezvous(): RendezvousClient {
  return {
    connect: vi.fn(),
    register: vi.fn(),
    unregister: vi.fn(),
    lookup: vi.fn(),
    signal: vi.fn(),
    requestRelay: vi.fn(),
    onSignal: vi.fn(),
    onInviteAccepted: vi.fn(),
    close: vi.fn(),
  };
}

describe("invite", () => {
  let mechaDir: string;

  beforeEach(() => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-invite-"));
  });
  afterEach(() => {
    rmSync(mechaDir, { recursive: true, force: true });
  });

  describe("createInviteCode", () => {
    it("creates a valid invite code", async () => {
      const identity = createNodeIdentity(mechaDir);
      const privateKey = loadNodePrivateKey(mechaDir)!;
      const client = makeMockRendezvous();

      const result = await createInviteCode({
        client,
        identity,
        nodeName: "test-node",
        noisePublicKey: "test-noise-pubkey",
        privateKey,
        rendezvousUrl: "wss://test.example.com",
      });

      expect(result.code).toMatch(/^mecha:\/\/invite\//);
      expect(result.expiresAt).toBeTruthy();
      expect(new Date(result.expiresAt).getTime()).toBeGreaterThan(Date.now());
    });

    it("respects custom expiry", async () => {
      const identity = createNodeIdentity(mechaDir);
      const privateKey = loadNodePrivateKey(mechaDir)!;
      const client = makeMockRendezvous();

      const before = Date.now();
      const result = await createInviteCode({
        client,
        identity,
        nodeName: "test-node",
        noisePublicKey: "test-noise-pubkey",
        privateKey,
        opts: { expiresIn: 3600 }, // 1 hour
      });

      const expiryMs = new Date(result.expiresAt).getTime();
      // Should expire ~1 hour from now (with some tolerance)
      expect(expiryMs).toBeGreaterThan(before + 3500 * 1000);
      expect(expiryMs).toBeLessThan(before + 3700 * 1000);
    });
  });

  describe("parseInviteCode", () => {
    it("round-trips with createInviteCode", async () => {
      const identity = createNodeIdentity(mechaDir);
      const privateKey = loadNodePrivateKey(mechaDir)!;
      const client = makeMockRendezvous();

      const invite = await createInviteCode({
        client,
        identity,
        nodeName: "test-node",
        noisePublicKey: "noise-key-base64url",
        privateKey,
        rendezvousUrl: "wss://test.example.com",
      });

      const payload = parseInviteCode(invite.code);
      expect(payload.inviterPublicKey).toBe(identity.publicKey);
      expect(payload.inviterFingerprint).toBe(identity.fingerprint);
      expect(payload.inviterNoisePublicKey).toBe("noise-key-base64url");
      expect(payload.rendezvousUrl).toBe("wss://test.example.com");
      expect(typeof payload.token).toBe("string");
    });

    it("rejects wrong scheme", () => {
      expect(() => parseInviteCode("https://example.com/invite/abc")).toThrow(InvalidInviteError);
      expect(() => parseInviteCode("https://example.com/invite/abc")).toThrow("Expected mecha:// scheme");
    });

    it("rejects empty payload", () => {
      expect(() => parseInviteCode("mecha://invite/")).toThrow(InvalidInviteError);
      expect(() => parseInviteCode("mecha://invite/")).toThrow("Malformed invite code");
    });

    it("rejects garbage payload", () => {
      expect(() => parseInviteCode("mecha://invite/not-valid-base64url!!!")).toThrow(InvalidInviteError);
    });

    it("rejects incomplete payload", () => {
      const partial = Buffer.from(JSON.stringify({ inviterName: "alice" })).toString("base64url");
      expect(() => parseInviteCode(`mecha://invite/${partial}`)).toThrow("Malformed invite code");
    });

    it("rejects expired invite", async () => {
      const identity = createNodeIdentity(mechaDir);
      const privateKey = loadNodePrivateKey(mechaDir)!;
      const client = makeMockRendezvous();

      // Create invite that expires immediately
      const invite = await createInviteCode({
        client,
        identity,
        nodeName: "test-node",
        noisePublicKey: "key",
        privateKey,
        opts: { expiresIn: -1 }, // Already expired
      });

      expect(() => parseInviteCode(invite.code)).toThrow("Invite expired");
    });

    it("rejects tampered invite (bad signature)", () => {
      // Build a payload manually with wrong signature
      const payload = {
        inviterName: "alice",
        inviterPublicKey: "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAtest\n-----END PUBLIC KEY-----",
        inviterFingerprint: "abcd1234abcd1234",
        inviterNoisePublicKey: "noise-key",
        rendezvousUrl: "wss://test.example.com",
        token: "abc123",
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        signature: "invalid-signature",
      };
      const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");

      expect(() => parseInviteCode(`mecha://invite/${encoded}`)).toThrow("Invalid invite signature");
    });

    it("rejects invalid rendezvous URL scheme", () => {
      const payload = {
        inviterName: "alice",
        inviterPublicKey: "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAtest\n-----END PUBLIC KEY-----",
        inviterFingerprint: "abcd1234abcd1234",
        inviterNoisePublicKey: "noise-key",
        rendezvousUrl: "file:///etc/passwd",
        token: "abc123",
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        signature: "test",
      };
      const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
      expect(() => parseInviteCode(`mecha://invite/${encoded}`)).toThrow("Invalid rendezvous URL scheme");
    });

    it("rejects invalid fingerprint format", () => {
      const payload = {
        inviterName: "alice",
        inviterPublicKey: "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAtest\n-----END PUBLIC KEY-----",
        inviterFingerprint: "tooshort",
        inviterNoisePublicKey: "noise-key",
        rendezvousUrl: "wss://test.example.com",
        token: "abc123",
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        signature: "test",
      };
      const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
      expect(() => parseInviteCode(`mecha://invite/${encoded}`)).toThrow("Invalid fingerprint format");
    });
  });
});
