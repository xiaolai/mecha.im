import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { ConfigStore } from "../src/config/config-store.js";
import { runMigrations } from "../src/db/sqlite.js";

describe("ConfigStore", () => {
  let db: Database.Database;
  let store: ConfigStore;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    runMigrations(db);
    store = new ConfigStore(db);
  });

  describe("get", () => {
    it("returns null for non-existent key", () => {
      expect(store.get("missing")).toBeNull();
    });

    it("returns value for existing key", () => {
      store.set("foo", "bar");
      expect(store.get("foo")).toBe("bar");
    });
  });

  describe("set", () => {
    it("inserts new key-value pair", () => {
      store.set("key1", "value1");
      expect(store.get("key1")).toBe("value1");
    });

    it("updates existing key (upsert)", () => {
      store.set("key1", "original");
      store.set("key1", "updated");
      expect(store.get("key1")).toBe("updated");
    });

    it("handles empty string values", () => {
      store.set("empty", "");
      expect(store.get("empty")).toBe("");
    });

    it("handles JSON values", () => {
      const json = JSON.stringify({ nested: { data: [1, 2, 3] } });
      store.set("config", json);
      expect(JSON.parse(store.get("config")!)).toEqual({ nested: { data: [1, 2, 3] } });
    });
  });

  describe("delete", () => {
    it("returns true when key existed", () => {
      store.set("key1", "value1");
      expect(store.delete("key1")).toBe(true);
      expect(store.get("key1")).toBeNull();
    });

    it("returns false when key did not exist", () => {
      expect(store.delete("nonexistent")).toBe(false);
    });
  });

  describe("list", () => {
    it("returns empty array when no entries", () => {
      expect(store.list()).toEqual([]);
    });

    it("returns all entries ordered by key", () => {
      store.set("beta", "2");
      store.set("alpha", "1");
      store.set("gamma", "3");

      const entries = store.list();
      expect(entries).toHaveLength(3);
      expect(entries.map((e) => e.key)).toEqual(["alpha", "beta", "gamma"]);
      expect(entries[0]!.value).toBe("1");
      expect(entries[0]!.updatedAt).toBeDefined();
    });

    it("filters by prefix", () => {
      store.set("mecha.system_prompt", "You are helpful");
      store.set("mecha.max_turns", "10");
      store.set("other.key", "unrelated");

      const entries = store.list("mecha.");
      expect(entries).toHaveLength(2);
      expect(entries.map((e) => e.key)).toEqual(["mecha.max_turns", "mecha.system_prompt"]);
    });

    it("returns empty when prefix matches nothing", () => {
      store.set("foo", "bar");
      expect(store.list("nonexistent")).toEqual([]);
    });
  });
});
