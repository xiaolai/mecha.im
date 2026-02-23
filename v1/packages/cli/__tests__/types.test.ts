import { describe, it, expect } from "vitest";
import { errMsg } from "../src/types.js";

describe("errMsg", () => {
  it("extracts message from Error", () => {
    expect(errMsg(new Error("boom"))).toBe("boom");
  });

  it("converts non-Error to string", () => {
    expect(errMsg("oops")).toBe("oops");
    expect(errMsg(42)).toBe("42");
    expect(errMsg(null)).toBe("null");
  });
});
