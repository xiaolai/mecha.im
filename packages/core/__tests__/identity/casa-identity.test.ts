import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { CasaName } from "../../src/types.js";
import { createNodeIdentity, loadNodePrivateKey } from "../../src/identity/node-identity.js";
import { createCasaIdentity, loadCasaIdentity, loadCasaIdentityFromDir } from "../../src/identity/casa-identity.js";
import { verifySignature } from "../../src/identity/signing.js";

describe("createCasaIdentity", () => {
  let mechaDir: string;
  let nodePrivateKey: string;

  beforeEach(() => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-casa-id-"));
    createNodeIdentity(mechaDir);
    nodePrivateKey = loadNodePrivateKey(mechaDir)!;
  });

  it("creates identity.json and casa.key in the CASA directory", () => {
    const nodeId = createNodeIdentity(mechaDir);
    const casaDir = join(mechaDir, "researcher");
    const casa = createCasaIdentity(casaDir, "researcher" as CasaName, nodeId, nodePrivateKey);

    expect(existsSync(join(casaDir, "identity.json"))).toBe(true);
    expect(existsSync(join(casaDir, "casa.key"))).toBe(true);
    expect(casa.name).toBe("researcher");
    expect(casa.nodeId).toBe(nodeId.id);
    expect(casa.publicKey).toContain("BEGIN PUBLIC KEY");
    expect(casa.nodePublicKey).toBe(nodeId.publicKey);
    expect(casa.fingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(casa.signature).toBeTruthy();
  });

  it("signature is verifiable with the node public key", () => {
    const nodeId = createNodeIdentity(mechaDir);
    const casaDir = join(mechaDir, "coder");
    const casa = createCasaIdentity(casaDir, "coder" as CasaName, nodeId, nodePrivateKey);

    const valid = verifySignature(
      nodeId.publicKey,
      new TextEncoder().encode(casa.publicKey),
      casa.signature,
    );
    expect(valid).toBe(true);
  });

  it("is idempotent — returns existing identity on second call", () => {
    const nodeId = createNodeIdentity(mechaDir);
    const casaDir = join(mechaDir, "worker");
    const first = createCasaIdentity(casaDir, "worker" as CasaName, nodeId, nodePrivateKey);
    const second = createCasaIdentity(casaDir, "worker" as CasaName, nodeId, nodePrivateKey);
    expect(second.publicKey).toBe(first.publicKey);
    expect(second.fingerprint).toBe(first.fingerprint);
  });

  it("each CASA gets a unique keypair", () => {
    const nodeId = createNodeIdentity(mechaDir);
    const a = createCasaIdentity(join(mechaDir, "a"), "a" as CasaName, nodeId, nodePrivateKey);
    const b = createCasaIdentity(join(mechaDir, "b"), "b" as CasaName, nodeId, nodePrivateKey);
    expect(a.publicKey).not.toBe(b.publicKey);
    expect(a.fingerprint).not.toBe(b.fingerprint);
  });
});

describe("loadCasaIdentity", () => {
  it("returns undefined for nonexistent CASA", () => {
    const mechaDir = mkdtempSync(join(tmpdir(), "mecha-no-casa-"));
    expect(loadCasaIdentity(mechaDir, "ghost" as CasaName)).toBeUndefined();
  });

  it("loads created identity by name", () => {
    const mechaDir = mkdtempSync(join(tmpdir(), "mecha-load-casa-"));
    const nodeId = createNodeIdentity(mechaDir);
    const nodeKey = loadNodePrivateKey(mechaDir)!;
    const casaDir = join(mechaDir, "agent");
    const created = createCasaIdentity(casaDir, "agent" as CasaName, nodeId, nodeKey);
    const loaded = loadCasaIdentity(mechaDir, "agent" as CasaName);
    expect(loaded).toEqual(created);
  });
});

describe("loadCasaIdentityFromDir", () => {
  it("returns undefined for empty directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "mecha-empty-casa-"));
    expect(loadCasaIdentityFromDir(dir)).toBeUndefined();
  });

  it("returns undefined for invalid identity JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "mecha-bad-casa-"));
    writeFileSync(join(dir, "identity.json"), JSON.stringify({ name: "x" }));
    expect(loadCasaIdentityFromDir(dir)).toBeUndefined();
  });
});
