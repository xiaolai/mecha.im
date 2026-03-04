import { describe, it, expect } from "vitest";
import {
  toUserMessage,
  toSafeMessage,
} from "../src/mapping.js";
import {
  BotNotFoundError,
} from "../src/errors.js";

describe("toUserMessage", () => {
  it("returns message from MechaError", () => {
    const err = new BotNotFoundError("researcher");
    expect(toUserMessage(err)).toBe('bot "researcher" not found');
  });

  it("returns message from plain Error", () => {
    expect(toUserMessage(new Error("oops"))).toBe("oops");
  });

  it("stringifies non-Error", () => {
    expect(toUserMessage(42)).toBe("42");
    expect(toUserMessage("text")).toBe("text");
  });
});

describe("toSafeMessage", () => {
  it("returns message from MechaError", () => {
    const err = new BotNotFoundError("researcher");
    expect(toSafeMessage(err)).toBe('bot "researcher" not found');
  });

  it('returns "Internal error" for plain Error', () => {
    expect(toSafeMessage(new Error("secret details"))).toBe("Internal error");
  });

  it('returns "Unknown error" for non-Error', () => {
    expect(toSafeMessage(42)).toBe("Unknown error");
    expect(toSafeMessage(null)).toBe("Unknown error");
  });
});
