import { describe, it, expect } from "vitest";
import {
  toHttpStatus,
  toExitCode,
  toUserMessage,
  toSafeMessage,
} from "../src/mapping.js";
import {
  CasaNotFoundError,
  ProcessSpawnError,
  AclDeniedError,
} from "../src/errors.js";

describe("toHttpStatus", () => {
  it("returns statusCode from MechaError", () => {
    expect(toHttpStatus(new CasaNotFoundError("x"))).toBe(404);
    expect(toHttpStatus(new ProcessSpawnError("fail"))).toBe(500);
    expect(toHttpStatus(new AclDeniedError("a", "b", "c"))).toBe(403);
  });

  it("returns 500 for plain Error", () => {
    expect(toHttpStatus(new Error("oops"))).toBe(500);
  });

  it("returns 500 for non-Error", () => {
    expect(toHttpStatus("string error")).toBe(500);
    expect(toHttpStatus(42)).toBe(500);
    expect(toHttpStatus(null)).toBe(500);
  });
});

describe("toExitCode", () => {
  it("returns exitCode from MechaError", () => {
    expect(toExitCode(new CasaNotFoundError("x"))).toBe(1);
    expect(toExitCode(new ProcessSpawnError("fail"))).toBe(2);
    expect(toExitCode(new AclDeniedError("a", "b", "c"))).toBe(3);
  });

  it("returns 1 for plain Error", () => {
    expect(toExitCode(new Error("oops"))).toBe(1);
  });

  it("returns 1 for non-Error", () => {
    expect(toExitCode("string")).toBe(1);
  });
});

describe("toUserMessage", () => {
  it("returns message from MechaError", () => {
    const err = new CasaNotFoundError("researcher");
    expect(toUserMessage(err)).toBe('CASA "researcher" not found');
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
    const err = new CasaNotFoundError("researcher");
    expect(toSafeMessage(err)).toBe('CASA "researcher" not found');
  });

  it('returns "Internal error" for plain Error', () => {
    expect(toSafeMessage(new Error("secret details"))).toBe("Internal error");
  });

  it('returns "Unknown error" for non-Error', () => {
    expect(toSafeMessage(42)).toBe("Unknown error");
    expect(toSafeMessage(null)).toBe("Unknown error");
  });
});
