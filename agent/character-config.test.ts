import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const TEST_DIR = join(import.meta.dirname, ".test-state-char");

describe("character-config", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.MECHA_STATE_DIR = TEST_DIR;
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    delete process.env.MECHA_STATE_DIR;
  });

  it("returns defaults when file missing", async () => {
    const { readCharacter } = await import("./character-config.js");
    const config = readCharacter();
    expect(config).toEqual({ skin: 0, hair: 0, outfit: "outfit1" });
  });

  it("reads saved config", async () => {
    writeFileSync(join(TEST_DIR, "character.json"), JSON.stringify({ skin: 3, hair: 5, outfit: "suit2" }));
    const { readCharacter } = await import("./character-config.js");
    const config = readCharacter();
    expect(config).toEqual({ skin: 3, hair: 5, outfit: "suit2" });
  });

  it("validates and rejects invalid skin", async () => {
    const { validateCharacter } = await import("./character-config.js");
    expect(validateCharacter({ skin: 6, hair: 0, outfit: "outfit1" })).toBe(false);
    expect(validateCharacter({ skin: -1, hair: 0, outfit: "outfit1" })).toBe(false);
  });

  it("validates and rejects invalid hair", async () => {
    const { validateCharacter } = await import("./character-config.js");
    expect(validateCharacter({ skin: 0, hair: 8, outfit: "outfit1" })).toBe(false);
  });

  it("validates and rejects invalid outfit", async () => {
    const { validateCharacter } = await import("./character-config.js");
    expect(validateCharacter({ skin: 0, hair: 0, outfit: "tuxedo1" })).toBe(false);
  });

  it("accepts valid configs", async () => {
    const { validateCharacter } = await import("./character-config.js");
    expect(validateCharacter({ skin: 5, hair: 7, outfit: "outfit6" })).toBe(true);
    expect(validateCharacter({ skin: 0, hair: 0, outfit: "suit4" })).toBe(true);
  });

  it("writes config to disk", async () => {
    const { writeCharacter } = await import("./character-config.js");
    writeCharacter({ skin: 2, hair: 4, outfit: "suit1" });
    const raw = readFileSync(join(TEST_DIR, "character.json"), "utf-8");
    expect(JSON.parse(raw)).toEqual({ skin: 2, hair: 4, outfit: "suit1" });
  });
});
