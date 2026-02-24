import { describe, it, expect, vi } from "vitest";
import { createProgram } from "../../src/program.js";
import { makeDeps } from "../test-utils.js";

// Mock casaChat to return an async iterable
vi.mock("@mecha/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mecha/service")>();
  return {
    ...actual,
    casaChat: vi.fn().mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        yield { type: "text", content: "Hello " };
        yield { type: "text", content: "world" };
        yield { type: "done", sessionId: "s1" };
      },
    }),
  };
});

describe("chat command", () => {
  it("streams chat response", async () => {
    const deps = makeDeps();
    const program = createProgram(deps);
    program.exitOverride();

    // Capture stdout
    const writes: string[] = [];
    const origWrite = process.stdout.write;
    process.stdout.write = ((chunk: string) => { writes.push(chunk); return true; }) as typeof process.stdout.write;

    try {
      await program.parseAsync(["node", "mecha", "chat", "researcher", "Hello"]);
    } finally {
      process.stdout.write = origWrite;
    }

    expect(writes.join("")).toContain("Hello ");
    expect(deps.formatter.info).toHaveBeenCalledWith(expect.stringContaining("Session: s1"));
  });

  it("reports error when no message provided", async () => {
    const deps = makeDeps();
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "chat", "researcher"]);
    expect(deps.formatter.error).toHaveBeenCalledWith("Message is required");
  });

  it("handles runtime 501 error from chat endpoint", async () => {
    const { casaChat } = await import("@mecha/service");
    vi.mocked(casaChat).mockRejectedValueOnce(
      new Error("Chat is handled by Claude Agent SDK. Use 'claude' CLI or Agent SDK directly."),
    );

    const deps = makeDeps();
    const program = createProgram(deps);
    program.exitOverride();

    await expect(
      program.parseAsync(["node", "mecha", "chat", "researcher", "Hello"]),
    ).rejects.toThrow("Chat is handled by Claude Agent SDK");
  });
});
