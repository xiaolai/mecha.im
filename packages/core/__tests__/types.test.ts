import { describe, it, expect } from "vitest";
import { isBotAddress, isGroupAddress } from "../src/types.js";
import type { BotName, NodeName, BotAddress, GroupAddress } from "../src/types.js";

describe("type guards", () => {
  const botAddr: BotAddress = {
    bot: "researcher" as BotName,
    node: "alice" as NodeName,
  };

  const groupAddr: GroupAddress = {
    group: "dev-team",
    members: [botAddr],
  };

  it("isBotAddress returns true for BotAddress", () => {
    expect(isBotAddress(botAddr)).toBe(true);
  });

  it("isBotAddress returns false for GroupAddress", () => {
    expect(isBotAddress(groupAddr)).toBe(false);
  });

  it("isGroupAddress returns true for GroupAddress", () => {
    expect(isGroupAddress(groupAddr)).toBe(true);
  });

  it("isGroupAddress returns false for BotAddress", () => {
    expect(isGroupAddress(botAddr)).toBe(false);
  });
});
