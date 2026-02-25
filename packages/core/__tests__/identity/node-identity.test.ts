import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createNodeIdentity, loadNodeIdentity, loadNodePrivateKey } from "../../src/identity/node-identity.js";

describe("createNodeIdentity", () => {
  let mechaDir: string;

  beforeEach(() => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-node-id-"));
  });

  it("creates identity files in mechaDir/identity/", () => {
    const id = createNodeIdentity(mechaDir);
    expect(existsSync(join(mechaDir, "identity", "node.json"))).toBe(true);
    expect(existsSync(join(mechaDir, "identity", "node.key"))).toBe(true);
    expect(id.publicKey).toContain("BEGIN PUBLIC KEY");
    expect(id.fingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(id.id).toBeTruthy();
    expect(id.createdAt).toBeTruthy();
  });

  it("is idempotent — returns existing identity on second call", () => {
    const first = createNodeIdentity(mechaDir);
    const second = createNodeIdentity(mechaDir);
    expect(second.id).toBe(first.id);
    expect(second.publicKey).toBe(first.publicKey);
    expect(second.fingerprint).toBe(first.fingerprint);
  });

  it("reuses existing node-id file from Phase 1 init", () => {
    const existingId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    writeFileSync(join(mechaDir, "node-id"), existingId);
    const identity = createNodeIdentity(mechaDir);
    expect(identity.id).toBe(existingId);
  });

  it("generates a new UUID if no node-id file exists", () => {
    const identity = createNodeIdentity(mechaDir);
    expect(identity.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});

describe("loadNodeIdentity", () => {
  it("returns undefined for empty mechaDir", () => {
    const empty = mkdtempSync(join(tmpdir(), "mecha-empty-"));
    expect(loadNodeIdentity(empty)).toBeUndefined();
  });

  it("returns the identity after creation", () => {
    const mechaDir = mkdtempSync(join(tmpdir(), "mecha-load-"));
    const created = createNodeIdentity(mechaDir);
    const loaded = loadNodeIdentity(mechaDir);
    expect(loaded).toEqual(created);
  });

  it("returns undefined for invalid node.json", () => {
    const mechaDir = mkdtempSync(join(tmpdir(), "mecha-bad-node-"));
    mkdirSync(join(mechaDir, "identity"), { recursive: true });
    writeFileSync(join(mechaDir, "identity", "node.json"), JSON.stringify({ id: "x" }));
    expect(loadNodeIdentity(mechaDir)).toBeUndefined();
  });
});

describe("loadNodePrivateKey", () => {
  it("returns undefined for empty mechaDir", () => {
    const empty = mkdtempSync(join(tmpdir(), "mecha-nokey-"));
    expect(loadNodePrivateKey(empty)).toBeUndefined();
  });

  it("returns PEM private key after creation", () => {
    const mechaDir = mkdtempSync(join(tmpdir(), "mecha-key-"));
    createNodeIdentity(mechaDir);
    const key = loadNodePrivateKey(mechaDir);
    expect(key).toContain("BEGIN PRIVATE KEY");
  });
});
