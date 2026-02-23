import { describe, it, expect, vi, beforeEach } from "vitest";
import { Command } from "commander";
import type { CommandDeps } from "../../src/types.js";
import type { Formatter } from "../../src/output/formatter.js";
import { registerChatCommand } from "../../src/commands/chat.js";

const mockMechaChat = vi.fn();
const mockMechaSessionCreate = vi.fn();
const mockMechaSessionMessage = vi.fn();

vi.mock("@mecha/service", () => ({
  mechaChat: (...args: unknown[]) => mockMechaChat(...args),
  mechaSessionCreate: (...args: unknown[]) => mockMechaSessionCreate(...args),
  mechaSessionMessage: (...args: unknown[]) => mockMechaSessionMessage(...args),
}));

function createMockFormatter(): Formatter {
  return { info: vi.fn(), error: vi.fn(), success: vi.fn(), json: vi.fn(), table: vi.fn() };
}

function createMockSSEResponse(lines: string[]): Response {
  const chunks = lines.map((l) => new TextEncoder().encode(l + "\n"));
  let idx = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (idx < chunks.length) {
        controller.enqueue(chunks[idx]!);
        idx++;
      } else {
        controller.close();
      }
    },
  });
  return { ok: true, body: stream } as unknown as Response;
}

describe("mecha chat", () => {
  let formatter: Formatter;
  let deps: CommandDeps;
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    formatter = createMockFormatter();
    deps = { processManager: {} as any, formatter };
    process.exitCode = undefined;
    vi.clearAllMocks();
    writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  });

  it("streams SSE text to stdout", async () => {
    const res = createMockSSEResponse([
      'data: {"text":"Hello"}',
      'data: {"text":" world"}',
      "data: [DONE]",
    ]);
    mockMechaChat.mockResolvedValueOnce(res);
    const program = new Command();
    registerChatCommand(program, deps);
    await program.parseAsync(["chat", "mx-test", "Hi there"], { from: "user" });

    const output = writeSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(output).toContain("Hello");
    expect(output).toContain(" world");
    writeSpy.mockRestore();
  });

  it("handles content field in SSE data", async () => {
    const res = createMockSSEResponse([
      'data: {"content":"Hi"}',
      "data: [DONE]",
    ]);
    mockMechaChat.mockResolvedValueOnce(res);
    const program = new Command();
    registerChatCommand(program, deps);
    await program.parseAsync(["chat", "mx-test", "hello"], { from: "user" });

    const output = writeSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(output).toContain("Hi");
    writeSpy.mockRestore();
  });

  it("handles delta.text field in SSE data", async () => {
    const res = createMockSSEResponse([
      'data: {"delta":{"text":"delta-text"}}',
      "data: [DONE]",
    ]);
    mockMechaChat.mockResolvedValueOnce(res);
    const program = new Command();
    registerChatCommand(program, deps);
    await program.parseAsync(["chat", "mx-test", "hello"], { from: "user" });

    const output = writeSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(output).toContain("delta-text");
    writeSpy.mockRestore();
  });

  it("handles empty response body", async () => {
    const res = { ok: true, body: null } as unknown as Response;
    mockMechaChat.mockResolvedValueOnce(res);
    const program = new Command();
    registerChatCommand(program, deps);
    await program.parseAsync(["chat", "mx-test", "hello"], { from: "user" });

    expect(formatter.info).toHaveBeenCalledWith("(empty response)");
    writeSpy.mockRestore();
  });

  it("handles non-JSON SSE lines gracefully", async () => {
    const res = createMockSSEResponse([
      "data: not-json",
      'data: {"text":"ok"}',
      "data: [DONE]",
    ]);
    mockMechaChat.mockResolvedValueOnce(res);
    const program = new Command();
    registerChatCommand(program, deps);
    await program.parseAsync(["chat", "mx-test", "hello"], { from: "user" });

    const output = writeSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(output).toContain("ok");
    writeSpy.mockRestore();
  });

  it("skips SSE data with no text fields", async () => {
    const res = createMockSSEResponse([
      'data: {"id":"msg-1"}',
      "data: [DONE]",
    ]);
    mockMechaChat.mockResolvedValueOnce(res);
    const program = new Command();
    registerChatCommand(program, deps);
    await program.parseAsync(["chat", "mx-test", "hello"], { from: "user" });

    // Only the trailing newline, no text content
    const textWrites = writeSpy.mock.calls.filter((c) => String(c[0]) !== "\n");
    expect(textWrites).toHaveLength(0);
    writeSpy.mockRestore();
  });

  it("ignores non-SSE lines", async () => {
    const res = createMockSSEResponse([
      ": keep-alive",
      "",
      'data: {"text":"ok"}',
      "data: [DONE]",
    ]);
    mockMechaChat.mockResolvedValueOnce(res);
    const program = new Command();
    registerChatCommand(program, deps);
    await program.parseAsync(["chat", "mx-test", "hello"], { from: "user" });

    const output = writeSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(output).toContain("ok");
    writeSpy.mockRestore();
  });

  it("writes trailing newline when stream ends without [DONE]", async () => {
    const res = createMockSSEResponse([
      'data: {"text":"partial"}',
    ]);
    mockMechaChat.mockResolvedValueOnce(res);
    const program = new Command();
    registerChatCommand(program, deps);
    await program.parseAsync(["chat", "mx-test", "hello"], { from: "user" });

    const output = writeSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(output).toContain("partial");
    expect(output).toContain("\n");
    writeSpy.mockRestore();
  });

  it("flushes remaining buffer when stream ends without trailing newline", async () => {
    // Simulate a stream that ends mid-line without newline
    const chunk = new TextEncoder().encode('data: {"text":"buffered"}');
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(chunk);
        controller.close();
      },
    });
    const res = { ok: true, body: stream } as unknown as Response;
    mockMechaChat.mockResolvedValueOnce(res);
    const program = new Command();
    registerChatCommand(program, deps);
    await program.parseAsync(["chat", "mx-test", "hello"], { from: "user" });

    const output = writeSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(output).toContain("buffered");
    writeSpy.mockRestore();
  });

  it("reports error on failure", async () => {
    mockMechaChat.mockRejectedValueOnce(new Error("connection failed"));
    const program = new Command();
    registerChatCommand(program, deps);
    await program.parseAsync(["chat", "mx-test", "hello"], { from: "user" });

    expect(formatter.error).toHaveBeenCalledWith(expect.stringContaining("connection failed"));
    expect(process.exitCode).toBe(1);
    writeSpy.mockRestore();
  });

  it("--session flag sends message to existing session via mechaSessionMessage", async () => {
    const res = createMockSSEResponse([
      'data: {"text":"session reply"}',
      "data: [DONE]",
    ]);
    mockMechaSessionMessage.mockResolvedValueOnce(res);
    const program = new Command();
    registerChatCommand(program, deps);
    await program.parseAsync(["chat", "mx-test", "Hi", "--session", "sess-123"], { from: "user" });

    expect(mockMechaSessionMessage).toHaveBeenCalledWith(
      deps.processManager,
      { id: "mx-test", sessionId: "sess-123", message: "Hi" },
    );
    const output = writeSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(output).toContain("session reply");
    writeSpy.mockRestore();
  });

  it("--new-session flag creates session then sends message", async () => {
    mockMechaSessionCreate.mockResolvedValueOnce({ sessionId: "test-session-id" });
    const res = createMockSSEResponse([
      'data: {"text":"new session reply"}',
      "data: [DONE]",
    ]);
    mockMechaSessionMessage.mockResolvedValueOnce(res);
    const program = new Command();
    registerChatCommand(program, deps);
    await program.parseAsync(["chat", "mx-test", "Hello", "--new-session"], { from: "user" });

    expect(mockMechaSessionCreate).toHaveBeenCalledWith(deps.processManager, { id: "mx-test" });
    expect(mockMechaSessionMessage).toHaveBeenCalledWith(
      deps.processManager,
      { id: "mx-test", sessionId: "test-session-id", message: "Hello" },
    );
    expect(formatter.info).toHaveBeenCalledWith("Session: test-session-id");
    const output = writeSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(output).toContain("new session reply");
    writeSpy.mockRestore();
  });

  it("--new-session reports error on failure", async () => {
    mockMechaSessionCreate.mockRejectedValueOnce(new Error("cap reached"));
    const program = new Command();
    registerChatCommand(program, deps);
    await program.parseAsync(["chat", "mx-test", "Hello", "--new-session"], { from: "user" });

    expect(formatter.error).toHaveBeenCalledWith(expect.stringContaining("cap reached"));
    expect(process.exitCode).toBe(1);
    writeSpy.mockRestore();
  });

  it("rejects --session and --new-session together", async () => {
    const program = new Command();
    registerChatCommand(program, deps);
    await program.parseAsync(["chat", "mx-test", "Hi", "--session", "s1", "--new-session"], { from: "user" });

    expect(formatter.error).toHaveBeenCalledWith("Cannot use --session and --new-session together");
    expect(process.exitCode).toBe(1);
    writeSpy.mockRestore();
  });

  it("--session reports error on failure", async () => {
    mockMechaSessionMessage.mockRejectedValueOnce(new Error("session not found"));
    const program = new Command();
    registerChatCommand(program, deps);
    await program.parseAsync(["chat", "mx-test", "Hi", "--session", "bad-sess"], { from: "user" });

    expect(formatter.error).toHaveBeenCalledWith(expect.stringContaining("session not found"));
    expect(process.exitCode).toBe(1);
    writeSpy.mockRestore();
  });
});
