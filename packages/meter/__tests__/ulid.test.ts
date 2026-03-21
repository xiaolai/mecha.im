import { describe, it, expect } from "vitest";
import { ulid } from "../src/ulid.js";

describe("ulid", () => {
  it("returns a 26-character string", () => {
    const id = ulid();
    expect(id).toHaveLength(26);
  });

  it("contains only valid Crockford Base32 characters", () => {
    const id = ulid();
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it("is time-sortable (lexicographic order = chronological)", () => {
    const a = ulid(1000);
    const b = ulid(2000);
    expect(a < b).toBe(true);
  });

  it("generates unique IDs", () => {
    const ids = new Set(Array.from({ length: 100 }, () => ulid()));
    expect(ids.size).toBe(100);
  });

  it("encodes timestamp correctly", () => {
    const ts = 0;
    const id = ulid(ts);
    // Timestamp part (first 10 chars) should be all zeros for epoch 0
    expect(id.slice(0, 10)).toBe("0000000000");
  });
});
