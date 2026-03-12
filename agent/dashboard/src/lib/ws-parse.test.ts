import { describe, it, expect } from "vitest";
import { parseWsMessage } from "./ws-parse";

describe("parseWsMessage", () => {
  it("handles ArrayBuffer as binary", () => {
    const buf = new ArrayBuffer(3);
    new Uint8Array(buf).set([1, 2, 3]);
    const result = parseWsMessage(buf);
    expect(result.kind).toBe("binary");
    if (result.kind === "binary") {
      expect(Array.from(result.data)).toEqual([1, 2, 3]);
    }
  });

  it("handles plain text", () => {
    const result = parseWsMessage("hello world");
    expect(result).toEqual({ kind: "text", data: "hello world" });
  });

  it("handles text starting with { but not valid JSON", () => {
    const result = parseWsMessage("{not valid json");
    expect(result).toEqual({ kind: "text", data: "{not valid json" });
  });

  it("handles JSON without __mecha flag as plain text", () => {
    const msg = JSON.stringify({ type: "some_event", data: 123 });
    const result = parseWsMessage(msg);
    expect(result).toEqual({ kind: "text", data: msg });
  });

  it("parses mecha session message", () => {
    const msg = JSON.stringify({ __mecha: true, type: "session", id: "abc-123" });
    const result = parseWsMessage(msg);
    expect(result).toEqual({ kind: "mecha-session", id: "abc-123" });
  });

  it("parses mecha exit message with code", () => {
    const msg = JSON.stringify({ __mecha: true, type: "exit", code: 0 });
    const result = parseWsMessage(msg);
    expect(result).toEqual({ kind: "mecha-exit", code: 0 });
  });

  it("parses mecha exit message without code (defaults to -1)", () => {
    const msg = JSON.stringify({ __mecha: true, type: "exit" });
    const result = parseWsMessage(msg);
    expect(result).toEqual({ kind: "mecha-exit", code: -1 });
  });

  it("parses mecha error message", () => {
    const msg = JSON.stringify({ __mecha: true, type: "error", message: "something broke" });
    const result = parseWsMessage(msg);
    expect(result).toEqual({ kind: "mecha-error", message: "something broke" });
  });

  it("parses mecha error without message (defaults)", () => {
    const msg = JSON.stringify({ __mecha: true, type: "error" });
    const result = parseWsMessage(msg);
    expect(result).toEqual({ kind: "mecha-error", message: "Unknown error" });
  });

  it("treats mecha session without id as plain text", () => {
    const msg = JSON.stringify({ __mecha: true, type: "session" });
    const result = parseWsMessage(msg);
    // No id → falls through to plain text since no branch matches
    expect(result).toEqual({ kind: "text", data: msg });
  });

  it("handles empty string", () => {
    const result = parseWsMessage("");
    expect(result).toEqual({ kind: "text", data: "" });
  });
});
