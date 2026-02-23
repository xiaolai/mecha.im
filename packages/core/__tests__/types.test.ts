import { describe, it, expect } from "vitest";
import { isCasaAddress, isGroupAddress } from "../src/types.js";
import type { CasaName, NodeName, CasaAddress, GroupAddress } from "../src/types.js";

describe("type guards", () => {
  const casaAddr: CasaAddress = {
    casa: "researcher" as CasaName,
    node: "alice" as NodeName,
  };

  const groupAddr: GroupAddress = {
    group: "dev-team",
    members: [casaAddr],
  };

  it("isCasaAddress returns true for CasaAddress", () => {
    expect(isCasaAddress(casaAddr)).toBe(true);
  });

  it("isCasaAddress returns false for GroupAddress", () => {
    expect(isCasaAddress(groupAddr)).toBe(false);
  });

  it("isGroupAddress returns true for GroupAddress", () => {
    expect(isGroupAddress(groupAddr)).toBe(true);
  });

  it("isGroupAddress returns false for CasaAddress", () => {
    expect(isGroupAddress(casaAddr)).toBe(false);
  });
});
