import { describe, it, expect } from "vitest";
import {
  botName,
  nodeName,
  parseAddress,
  formatAddress,
} from "../src/address.js";
import { InvalidNameError } from "../src/errors.js";
import type { BotName, NodeName, BotAddress } from "../src/types.js";

describe("botName", () => {
  it("brands a valid name", () => {
    const name = botName("researcher");
    expect(name).toBe("researcher");
  });

  it("rejects an empty string with InvalidNameError", () => {
    expect(() => botName("")).toThrow(InvalidNameError);
    try { botName(""); } catch (e: any) {
      expect(e.code).toBe("INVALID_NAME");
    }
  });

  it("rejects uppercase", () => {
    expect(() => botName("UPPER")).toThrow(InvalidNameError);
  });

  it("rejects leading hyphen", () => {
    expect(() => botName("-leading")).toThrow(InvalidNameError);
  });

  it("rejects trailing hyphen", () => {
    expect(() => botName("trailing-")).toThrow(InvalidNameError);
  });

  it("rejects names longer than 32 chars", () => {
    expect(() => botName("a".repeat(33))).toThrow(InvalidNameError);
  });
});

describe("nodeName", () => {
  it("brands a valid name", () => {
    const name = nodeName("alice");
    expect(name).toBe("alice");
  });

  it("rejects invalid input with InvalidNameError", () => {
    expect(() => nodeName("")).toThrow(InvalidNameError);
    try { nodeName(""); } catch (e: any) {
      expect(e.code).toBe("INVALID_NAME");
    }
  });
});

describe("parseAddress", () => {
  it('parses bare name as local: "researcher" → { bot: "researcher", node: "local" }', () => {
    const addr = parseAddress("researcher");
    expect(addr).toEqual({ bot: "researcher", node: "local" });
  });

  it('parses qualified address: "researcher@alice"', () => {
    const addr = parseAddress("researcher@alice");
    expect(addr).toEqual({ bot: "researcher", node: "alice" });
  });

  it("throws on group address (not supported yet)", () => {
    expect(() => parseAddress("+dev-team")).toThrow("Group addresses are not supported yet");
  });

  it("throws on empty string", () => {
    expect(() => parseAddress("")).toThrow('Invalid address: ""');
  });

  it("throws on uppercase", () => {
    expect(() => parseAddress("UPPERCASE")).toThrow(InvalidNameError);
  });

  it("throws on multiple @ signs", () => {
    expect(() => parseAddress("a@b@c")).toThrow('Invalid address: "a@b@c"');
  });

  it("throws when bot name is too long", () => {
    expect(() => parseAddress("a".repeat(33) + "@b")).toThrow(InvalidNameError);
  });

  it("throws when node name is too long", () => {
    expect(() => parseAddress("a@" + "b".repeat(33))).toThrow(InvalidNameError);
  });

  it("throws on invalid characters in bot part", () => {
    expect(() => parseAddress("has.dot@node")).toThrow(InvalidNameError);
  });

  it("throws on invalid characters in node part", () => {
    expect(() => parseAddress("bot@has.dot")).toThrow(InvalidNameError);
  });
});

describe("formatAddress", () => {
  it('formats local address without node: "researcher"', () => {
    const addr: BotAddress = {
      bot: "researcher" as BotName,
      node: "local" as NodeName,
    };
    expect(formatAddress(addr)).toBe("researcher");
  });

  it('formats remote address with node: "researcher@alice"', () => {
    const addr: BotAddress = {
      bot: "researcher" as BotName,
      node: "alice" as NodeName,
    };
    expect(formatAddress(addr)).toBe("researcher@alice");
  });
});

describe("parseAddress / formatAddress round-trip", () => {
  it("round-trips local address", () => {
    const addr = parseAddress("researcher");
    expect(formatAddress(addr as BotAddress)).toBe("researcher");
  });

  it("round-trips remote address", () => {
    const addr = parseAddress("researcher@alice");
    expect(formatAddress(addr as BotAddress)).toBe("researcher@alice");
  });
});
