import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createCredentialStore } from "../src/credentials.js";

let tempDir: string;

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined as unknown as string;
  }
});

function setup() {
  tempDir = mkdtempSync(join(tmpdir(), "mecha-creds-"));
  return createCredentialStore(tempDir);
}

describe("setSecret / getSecret", () => {
  it("stores and retrieves a secret", () => {
    const store = setup();
    store.setSecret("api-key", "sk-12345");
    expect(store.getSecret("api-key")).toBe("sk-12345");
  });

  it("returns undefined for non-existent secret", () => {
    const store = setup();
    expect(store.getSecret("missing")).toBeUndefined();
  });

  it("updates an existing secret", () => {
    const store = setup();
    store.setSecret("token", "v1");
    store.setSecret("token", "v2");
    expect(store.getSecret("token")).toBe("v2");
  });

  it("stores values as base64 (not plaintext)", () => {
    const store = setup();
    store.setSecret("pw", "hunter2");
    // Read the raw file to verify encoding
    const raw = readFileSync(join(tempDir, "secrets.json"), "utf-8");
    expect(raw).not.toContain("hunter2");
    expect(raw).toContain(Buffer.from("hunter2").toString("base64"));
  });
});

describe("listSecrets", () => {
  it("returns empty array when no secrets", () => {
    const store = setup();
    expect(store.listSecrets()).toEqual([]);
  });

  it("lists secret names without values", () => {
    const store = setup();
    store.setSecret("key-a", "val-a");
    store.setSecret("key-b", "val-b");
    const names = store.listSecrets();
    expect(names).toEqual(["key-a", "key-b"]);
  });
});

describe("deleteSecret", () => {
  it("deletes an existing secret", () => {
    const store = setup();
    store.setSecret("gone", "bye");
    expect(store.deleteSecret("gone")).toBe(true);
    expect(store.getSecret("gone")).toBeUndefined();
    expect(store.listSecrets()).toEqual([]);
  });

  it("returns false for non-existent secret", () => {
    const store = setup();
    expect(store.deleteSecret("nope")).toBe(false);
  });

  it("removes grants when secret is deleted", () => {
    const store = setup();
    store.setSecret("db-pass", "secret");
    store.grantAccess("db-pass", "alice");
    store.deleteSecret("db-pass");
    expect(store.checkAccess("db-pass", "alice")).toBe(false);
  });
});

describe("grantAccess / revokeAccess / checkAccess", () => {
  it("grants and checks access", () => {
    const store = setup();
    store.setSecret("key", "val");
    expect(store.checkAccess("key", "bot-a")).toBe(false);
    store.grantAccess("key", "bot-a");
    expect(store.checkAccess("key", "bot-a")).toBe(true);
  });

  it("is idempotent for duplicate grants", () => {
    const store = setup();
    store.setSecret("key", "val");
    store.grantAccess("key", "bot-a");
    store.grantAccess("key", "bot-a");
    expect(store.checkAccess("key", "bot-a")).toBe(true);
    // Revoke once should clear it
    expect(store.revokeAccess("key", "bot-a")).toBe(true);
    expect(store.checkAccess("key", "bot-a")).toBe(false);
  });

  it("revokes access", () => {
    const store = setup();
    store.grantAccess("key", "bot-b");
    expect(store.revokeAccess("key", "bot-b")).toBe(true);
    expect(store.checkAccess("key", "bot-b")).toBe(false);
  });

  it("returns false when revoking non-existent grant", () => {
    const store = setup();
    expect(store.revokeAccess("key", "bot-c")).toBe(false);
  });

  it("isolates grants between bots", () => {
    const store = setup();
    store.grantAccess("key", "alice");
    store.grantAccess("key", "bob");
    expect(store.checkAccess("key", "alice")).toBe(true);
    expect(store.checkAccess("key", "bob")).toBe(true);
    expect(store.checkAccess("key", "charlie")).toBe(false);
  });
});
