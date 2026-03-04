import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { BotName } from "../../src/types.js";
import { createNodeIdentity, loadNodePrivateKey } from "../../src/identity/node-identity.js";
import { createBotIdentity, loadBotIdentity, loadBotIdentityFromDir } from "../../src/identity/bot-identity.js";
import { verifySignature } from "../../src/identity/signing.js";

describe("createBotIdentity", () => {
  let mechaDir: string;
  let nodePrivateKey: string;

  beforeEach(() => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-bot-id-"));
    createNodeIdentity(mechaDir);
    nodePrivateKey = loadNodePrivateKey(mechaDir)!;
  });

  it("creates identity.json and bot.key in the bot directory", () => {
    const nodeId = createNodeIdentity(mechaDir);
    const botDir = join(mechaDir, "researcher");
    const bot = createBotIdentity(botDir, "researcher" as BotName, nodeId, nodePrivateKey);

    expect(existsSync(join(botDir, "identity.json"))).toBe(true);
    expect(existsSync(join(botDir, "bot.key"))).toBe(true);
    expect(bot.name).toBe("researcher");
    expect(bot.nodeId).toBe(nodeId.id);
    expect(bot.publicKey).toContain("BEGIN PUBLIC KEY");
    expect(bot.nodePublicKey).toBe(nodeId.publicKey);
    expect(bot.fingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(bot.signature).toBeTruthy();
  });

  it("signature is verifiable with the node public key", () => {
    const nodeId = createNodeIdentity(mechaDir);
    const botDir = join(mechaDir, "coder");
    const bot = createBotIdentity(botDir, "coder" as BotName, nodeId, nodePrivateKey);

    const valid = verifySignature(
      nodeId.publicKey,
      new TextEncoder().encode(bot.publicKey),
      bot.signature,
    );
    expect(valid).toBe(true);
  });

  it("is idempotent — returns existing identity on second call", () => {
    const nodeId = createNodeIdentity(mechaDir);
    const botDir = join(mechaDir, "worker");
    const first = createBotIdentity(botDir, "worker" as BotName, nodeId, nodePrivateKey);
    const second = createBotIdentity(botDir, "worker" as BotName, nodeId, nodePrivateKey);
    expect(second.publicKey).toBe(first.publicKey);
    expect(second.fingerprint).toBe(first.fingerprint);
  });

  it("each bot gets a unique keypair", () => {
    const nodeId = createNodeIdentity(mechaDir);
    const a = createBotIdentity(join(mechaDir, "a"), "a" as BotName, nodeId, nodePrivateKey);
    const b = createBotIdentity(join(mechaDir, "b"), "b" as BotName, nodeId, nodePrivateKey);
    expect(a.publicKey).not.toBe(b.publicKey);
    expect(a.fingerprint).not.toBe(b.fingerprint);
  });
});

describe("loadBotIdentity", () => {
  it("returns undefined for nonexistent bot", () => {
    const mechaDir = mkdtempSync(join(tmpdir(), "mecha-no-bot-"));
    expect(loadBotIdentity(mechaDir, "ghost" as BotName)).toBeUndefined();
  });

  it("loads created identity by name", () => {
    const mechaDir = mkdtempSync(join(tmpdir(), "mecha-load-bot-"));
    const nodeId = createNodeIdentity(mechaDir);
    const nodeKey = loadNodePrivateKey(mechaDir)!;
    const botDir = join(mechaDir, "agent");
    const created = createBotIdentity(botDir, "agent" as BotName, nodeId, nodeKey);
    const loaded = loadBotIdentity(mechaDir, "agent" as BotName);
    expect(loaded).toEqual(created);
  });
});

describe("loadBotIdentityFromDir", () => {
  it("returns undefined for empty directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "mecha-empty-bot-"));
    expect(loadBotIdentityFromDir(dir)).toBeUndefined();
  });

  it("returns undefined for invalid identity JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "mecha-bad-bot-"));
    writeFileSync(join(dir, "identity.json"), JSON.stringify({ name: "x" }));
    expect(loadBotIdentityFromDir(dir)).toBeUndefined();
  });
});
