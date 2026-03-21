import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { StoredSecret, SecretGrant, CredentialStore } from "./types.js";

/**
 * Create a file-backed credential store.
 * Secrets persist to secrets.json, access grants to grants.json.
 */
export function createCredentialStore(secretsDir: string): CredentialStore {
  mkdirSync(secretsDir, { recursive: true });
  const secretsPath = join(secretsDir, "secrets.json");
  const grantsPath = join(secretsDir, "grants.json");

  function loadSecrets(): StoredSecret[] {
    if (!existsSync(secretsPath)) return [];
    return JSON.parse(readFileSync(secretsPath, "utf-8")) as StoredSecret[];
  }

  function saveSecrets(secrets: StoredSecret[]): void {
    writeFileSync(secretsPath, JSON.stringify(secrets, null, 2) + "\n", { mode: 0o600 });
  }

  function loadGrants(): SecretGrant[] {
    if (!existsSync(grantsPath)) return [];
    return JSON.parse(readFileSync(grantsPath, "utf-8")) as SecretGrant[];
  }

  function saveGrants(grants: SecretGrant[]): void {
    writeFileSync(grantsPath, JSON.stringify(grants, null, 2) + "\n", { mode: 0o600 });
  }

  function encode(value: string): string {
    return Buffer.from(value, "utf-8").toString("base64");
  }

  function decode(encoded: string): string {
    return Buffer.from(encoded, "base64").toString("utf-8");
  }

  return {
    setSecret(name, value) {
      const secrets = loadSecrets();
      const now = new Date().toISOString();
      const idx = secrets.findIndex((s) => s.name === name);
      const encoded = encode(value);
      if (idx >= 0) {
        secrets[idx] = { ...secrets[idx]!, value: encoded, updatedAt: now };
      } else {
        secrets.push({ name, value: encoded, createdAt: now, updatedAt: now });
      }
      saveSecrets(secrets);
    },

    getSecret(name) {
      const secrets = loadSecrets();
      const secret = secrets.find((s) => s.name === name);
      if (!secret) return undefined;
      return decode(secret.value);
    },

    listSecrets() {
      return loadSecrets().map((s) => s.name);
    },

    deleteSecret(name) {
      const secrets = loadSecrets();
      const idx = secrets.findIndex((s) => s.name === name);
      if (idx === -1) return false;
      secrets.splice(idx, 1);
      saveSecrets(secrets);
      // Remove all grants for this secret
      const grants = loadGrants().filter((g) => g.secretName !== name);
      saveGrants(grants);
      return true;
    },

    grantAccess(secretName, botName) {
      const grants = loadGrants();
      const exists = grants.some(
        (g) => g.secretName === secretName && g.botName === botName,
      );
      if (exists) return;
      grants.push({
        secretName,
        botName,
        grantedAt: new Date().toISOString(),
      });
      saveGrants(grants);
    },

    revokeAccess(secretName, botName) {
      const grants = loadGrants();
      const idx = grants.findIndex(
        (g) => g.secretName === secretName && g.botName === botName,
      );
      if (idx === -1) return false;
      grants.splice(idx, 1);
      saveGrants(grants);
      return true;
    },

    checkAccess(secretName, botName) {
      const grants = loadGrants();
      return grants.some(
        (g) => g.secretName === secretName && g.botName === botName,
      );
    },
  };
}
