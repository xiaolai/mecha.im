import { describe, it, expect } from "vitest";
import { matchesDiscoveryFilter } from "../src/discovery.js";

describe("matchesDiscoveryFilter", () => {
  const entry = { tags: ["ai", "finance"], expose: ["query", "read"] };

  it("matches when no filters provided", () => {
    expect(matchesDiscoveryFilter(entry, {})).toBe(true);
  });

  it("matches single tag present", () => {
    expect(matchesDiscoveryFilter(entry, { tag: "ai" })).toBe(true);
  });

  it("rejects single tag absent", () => {
    expect(matchesDiscoveryFilter(entry, { tag: "health" })).toBe(false);
  });

  it("matches when all tags present", () => {
    expect(matchesDiscoveryFilter(entry, { tags: ["ai", "finance"] })).toBe(true);
  });

  it("rejects when any tag missing", () => {
    expect(matchesDiscoveryFilter(entry, { tags: ["ai", "health"] })).toBe(false);
  });

  it("matches empty tags array", () => {
    expect(matchesDiscoveryFilter(entry, { tags: [] })).toBe(true);
  });

  it("matches capability present", () => {
    expect(matchesDiscoveryFilter(entry, { capability: "query" })).toBe(true);
  });

  it("rejects capability absent", () => {
    expect(matchesDiscoveryFilter(entry, { capability: "write" })).toBe(false);
  });

  it("matches combined filters all passing", () => {
    expect(matchesDiscoveryFilter(entry, { tag: "ai", capability: "query" })).toBe(true);
  });

  it("rejects when tag matches but capability doesn't", () => {
    expect(matchesDiscoveryFilter(entry, { tag: "ai", capability: "write" })).toBe(false);
  });

  it("rejects when capability matches but tag doesn't", () => {
    expect(matchesDiscoveryFilter(entry, { tag: "health", capability: "query" })).toBe(false);
  });

  it("matches entry with empty tags and expose when no filter", () => {
    expect(matchesDiscoveryFilter({ tags: [], expose: [] }, {})).toBe(true);
  });
});
