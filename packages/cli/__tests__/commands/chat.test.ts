import { describe, it, expect, vi } from "vitest";
import { createProgram } from "../../src/program.js";
import { makeDeps } from "../test-utils.js";

// Mock botChat to return a ChatResult
vi.mock("@mecha/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mecha/service")>();
  return {
    ...actual,
    botChat: vi.fn().mockResolvedValue({
      response: "Hello world",
      sessionId: "s1",
      durationMs: 42,
      costUsd: 0.001,
    }),
  };
});

describe("chat command", () => {
  it("prints chat response", async () => {
    const deps = makeDeps();
    const program = createProgram(deps);
    program.exitOverride();

    // Capture stdout
    const writes: string[] = [];
    const origWrite = process.stdout.write;
    process.stdout.write = ((chunk: string) => { writes.push(chunk); return true; }) as typeof process.stdout.write;

    try {
      await program.parseAsync(["node", "mecha", "bot", "chat", "researcher", "Hello"]);
    } finally {
      process.stdout.write = origWrite;
    }

    expect(writes.join("")).toContain("Hello world");
    expect(deps.formatter.info).toHaveBeenCalledWith(expect.stringContaining("Session: s1"));
  });

  it("reports error when no message provided", async () => {
    const deps = makeDeps();
    const program = createProgram(deps);
    program.exitOverride();

    await expect(
      program.parseAsync(["node", "mecha", "bot", "chat", "researcher"]),
    ).rejects.toThrow(); // Commander throws on missing required argument <message>
  });

  it("handles runtime error from chat endpoint", async () => {
    const { botChat } = await import("@mecha/service");
    vi.mocked(botChat).mockRejectedValueOnce(
      new Error("SDK query failed"),
    );

    const deps = makeDeps();
    const program = createProgram(deps);
    program.exitOverride();

    await expect(
      program.parseAsync(["node", "mecha", "bot", "chat", "researcher", "Hello"]),
    ).rejects.toThrow("SDK query failed");
  });
});
