import { describe, it, expect, vi } from "vitest";
import { MechaNotLocatedError, SessionNotFoundError } from "@mecha/contracts";
import { toolError, textResult } from "../src/errors.js";

describe("toolError", () => {
  it("maps Error instances to error content", () => {
    const result = toolError(new Error("something broke"));
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("Error: something broke");
  });

  it("maps non-Error values to string", () => {
    const result = toolError("string error");
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("Error: string error");
  });

  it("invalidates locator cache on MechaNotLocatedError", () => {
    const locator = { invalidate: vi.fn(), locate: vi.fn(), clear: vi.fn() } as any;
    toolError(new MechaNotLocatedError("mx-a"), locator, "mx-a");
    expect(locator.invalidate).toHaveBeenCalledWith("mx-a");
  });

  it("invalidates locator cache on SessionNotFoundError", () => {
    const locator = { invalidate: vi.fn(), locate: vi.fn(), clear: vi.fn() } as any;
    toolError(new SessionNotFoundError("s1"), locator, "mx-a");
    expect(locator.invalidate).toHaveBeenCalledWith("mx-a");
  });

  it("does not invalidate for other error types", () => {
    const locator = { invalidate: vi.fn(), locate: vi.fn(), clear: vi.fn() } as any;
    toolError(new Error("generic"), locator, "mx-a");
    expect(locator.invalidate).not.toHaveBeenCalled();
  });

  it("does not invalidate without locator or mechaId", () => {
    const result = toolError(new MechaNotLocatedError("mx-a"));
    expect(result.isError).toBe(true);
    // No crash — no locator provided

    const locator = { invalidate: vi.fn(), locate: vi.fn(), clear: vi.fn() } as any;
    toolError(new MechaNotLocatedError("mx-a"), locator);
    // No invalidation because mechaId is undefined
    expect(locator.invalidate).not.toHaveBeenCalled();
  });
});

describe("textResult", () => {
  it("creates text content result", () => {
    const result = textResult("hello");
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toBe("hello");
  });
});
