import { describe, it, expect } from "vitest";
import { parseSSELine } from "../../src/components/office/use-activity-stream";

describe("parseSSELine", () => {
  it("parses data lines", () => {
    const result = parseSSELine('data: {"type":"activity","name":"alice","activity":"thinking","timestamp":"2026-01-01T00:00:00Z"}');
    expect(result).toBeDefined();
    expect(result!.name).toBe("alice");
    expect(result!.activity).toBe("thinking");
  });

  it("returns null for comment lines", () => {
    expect(parseSSELine(": heartbeat")).toBeNull();
  });

  it("returns null for empty lines", () => {
    expect(parseSSELine("")).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(parseSSELine("data: {invalid}")).toBeNull();
  });

  it("returns null for non-data lines", () => {
    expect(parseSSELine("event: something")).toBeNull();
  });
});
