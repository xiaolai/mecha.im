import { describe, it, expect } from "vitest";
import {
  casaName,
  nodeName,
  parseAddress,
  formatAddress,
} from "../src/address.js";
import type { CasaName, NodeName, CasaAddress } from "../src/types.js";

describe("casaName", () => {
  it("brands a valid name", () => {
    const name = casaName("researcher");
    expect(name).toBe("researcher");
  });

  it("rejects an empty string", () => {
    expect(() => casaName("")).toThrow("Invalid CASA name");
  });

  it("rejects uppercase", () => {
    expect(() => casaName("UPPER")).toThrow("Invalid CASA name");
  });

  it("rejects leading hyphen", () => {
    expect(() => casaName("-leading")).toThrow("Invalid CASA name");
  });

  it("rejects trailing hyphen", () => {
    expect(() => casaName("trailing-")).toThrow("Invalid CASA name");
  });

  it("rejects names longer than 32 chars", () => {
    expect(() => casaName("a".repeat(33))).toThrow("Invalid CASA name");
  });
});

describe("nodeName", () => {
  it("brands a valid name", () => {
    const name = nodeName("alice");
    expect(name).toBe("alice");
  });

  it("rejects invalid input", () => {
    expect(() => nodeName("")).toThrow("Invalid node name");
  });
});

describe("parseAddress", () => {
  it('parses bare name as local: "researcher" → { casa: "researcher", node: "local" }', () => {
    const addr = parseAddress("researcher");
    expect(addr).toEqual({ casa: "researcher", node: "local" });
  });

  it('parses qualified address: "researcher@alice"', () => {
    const addr = parseAddress("researcher@alice");
    expect(addr).toEqual({ casa: "researcher", node: "alice" });
  });

  it("throws on group address (not supported yet)", () => {
    expect(() => parseAddress("+dev-team")).toThrow("Group addresses are not supported yet");
  });

  it("throws on empty string", () => {
    expect(() => parseAddress("")).toThrow("empty string");
  });

  it("throws on uppercase", () => {
    expect(() => parseAddress("UPPERCASE")).toThrow("Invalid CASA name");
  });

  it("throws on multiple @ signs", () => {
    expect(() => parseAddress("a@b@c")).toThrow("multiple @ signs");
  });

  it("throws when casa name is too long", () => {
    expect(() => parseAddress("a".repeat(33) + "@b")).toThrow("Invalid CASA name");
  });

  it("throws when node name is too long", () => {
    expect(() => parseAddress("a@" + "b".repeat(33))).toThrow("Invalid node name");
  });

  it("throws on invalid characters in casa part", () => {
    expect(() => parseAddress("has.dot@node")).toThrow("Invalid CASA name");
  });

  it("throws on invalid characters in node part", () => {
    expect(() => parseAddress("casa@has.dot")).toThrow("Invalid node name");
  });
});

describe("formatAddress", () => {
  it('formats local address without node: "researcher"', () => {
    const addr: CasaAddress = {
      casa: "researcher" as CasaName,
      node: "local" as NodeName,
    };
    expect(formatAddress(addr)).toBe("researcher");
  });

  it('formats remote address with node: "researcher@alice"', () => {
    const addr: CasaAddress = {
      casa: "researcher" as CasaName,
      node: "alice" as NodeName,
    };
    expect(formatAddress(addr)).toBe("researcher@alice");
  });
});

describe("parseAddress / formatAddress round-trip", () => {
  it("round-trips local address", () => {
    const addr = parseAddress("researcher");
    expect(formatAddress(addr as CasaAddress)).toBe("researcher");
  });

  it("round-trips remote address", () => {
    const addr = parseAddress("researcher@alice");
    expect(formatAddress(addr as CasaAddress)).toBe("researcher@alice");
  });
});
