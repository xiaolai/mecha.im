import { describe, it, expect } from "vitest";
import { mechaRefKey, parseMechaRefKey, type MechaRef } from "../src/index.js";

describe("mechaRefKey", () => {
  it("returns bare id for local node", () => {
    expect(mechaRefKey({ node: "local", id: "mx-foo-abc" })).toBe("mx-foo-abc");
  });

  it("returns node/id for remote node", () => {
    expect(mechaRefKey({ node: "gpu-server", id: "mx-foo-abc" })).toBe("gpu-server/mx-foo-abc");
  });
});

describe("parseMechaRefKey", () => {
  it("parses bare id as local", () => {
    expect(parseMechaRefKey("mx-foo-abc")).toEqual({ node: "local", id: "mx-foo-abc" });
  });

  it("parses node/id as remote", () => {
    expect(parseMechaRefKey("gpu-server/mx-foo-abc")).toEqual({ node: "gpu-server", id: "mx-foo-abc" });
  });

  it("handles node name with mecha ID containing hyphens", () => {
    expect(parseMechaRefKey("work/mx-a-b")).toEqual({ node: "work", id: "mx-a-b" });
  });
});

describe("round-trip", () => {
  it("local ref survives round-trip", () => {
    const ref: MechaRef = { node: "local", id: "mx-foo-abc123" };
    expect(parseMechaRefKey(mechaRefKey(ref))).toEqual(ref);
  });

  it("remote ref survives round-trip", () => {
    const ref: MechaRef = { node: "gpu-server", id: "mx-bar-def456" };
    expect(parseMechaRefKey(mechaRefKey(ref))).toEqual(ref);
  });
});
