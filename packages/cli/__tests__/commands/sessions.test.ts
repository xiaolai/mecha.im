import { describe, it, expect, vi, beforeEach } from "vitest";
import { Command } from "commander";
import type { CommandDeps } from "../../src/types.js";
import type { Formatter } from "../../src/output/formatter.js";
import { registerSessionsCommand } from "../../src/commands/sessions.js";

const mockMechaSessionList = vi.fn();
const mockMechaSessionGet = vi.fn();
const mockMechaSessionDelete = vi.fn();
const mockMechaSessionInterrupt = vi.fn();
const mockMechaSessionRename = vi.fn();
const mockMechaSessionConfigUpdate = vi.fn();
const mockRemoteSessionList = vi.fn();
const mockRemoteSessionGet = vi.fn();
const mockRemoteSessionMetaUpdate = vi.fn();
const mockRemoteSessionDelete = vi.fn();

vi.mock("@mecha/service", () => ({
  mechaSessionList: (...args: unknown[]) => mockMechaSessionList(...args),
  mechaSessionGet: (...args: unknown[]) => mockMechaSessionGet(...args),
  mechaSessionDelete: (...args: unknown[]) => mockMechaSessionDelete(...args),
  mechaSessionInterrupt: (...args: unknown[]) => mockMechaSessionInterrupt(...args),
  mechaSessionRename: (...args: unknown[]) => mockMechaSessionRename(...args),
  mechaSessionConfigUpdate: (...args: unknown[]) => mockMechaSessionConfigUpdate(...args),
  remoteSessionList: (...args: unknown[]) => mockRemoteSessionList(...args),
  remoteSessionGet: (...args: unknown[]) => mockRemoteSessionGet(...args),
  remoteSessionMetaUpdate: (...args: unknown[]) => mockRemoteSessionMetaUpdate(...args),
  remoteSessionDelete: (...args: unknown[]) => mockRemoteSessionDelete(...args),
}));

const mockResolveTarget = vi.fn();
vi.mock("../../src/commands/resolve-target.js", () => ({
  resolveTarget: (...args: unknown[]) => mockResolveTarget(...args),
}));

vi.mock("../../src/commands/shared-options.js", async (importOriginal) => {
  return importOriginal();
});

function createMockFormatter(): Formatter {
  return { info: vi.fn(), error: vi.fn(), success: vi.fn(), json: vi.fn(), table: vi.fn() };
}

// Session summary matching new SessionSummary type from core
function makeSummary(overrides: Record<string, unknown> = {}) {
  return {
    id: "abcdef1234567890",
    projectSlug: "-home-mecha",
    title: "My Session",
    messageCount: 5,
    model: "claude-sonnet-4-6",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

// Parsed session matching ParsedSession type
function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: "sess-abc",
    projectSlug: "-home-mecha",
    title: "Test Session",
    messageCount: 2,
    model: "claude-sonnet-4-6",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:01Z"),
    messages: [
      {
        uuid: "u1",
        parentUuid: null,
        role: "user",
        content: [{ type: "text", text: "Hello" }],
        timestamp: new Date("2026-01-01T00:00:00Z"),
      },
      {
        uuid: "a1",
        parentUuid: "u1",
        role: "assistant",
        content: [
          { type: "thinking", thinking: "Let me think about this request carefully" },
          { type: "text", text: "Hi!" },
          { type: "tool_use", id: "toolu_1", name: "Read", input: { file: "foo.ts" } },
        ],
        model: "claude-sonnet-4-6",
        usage: { inputTokens: 500, outputTokens: 250 },
        timestamp: new Date("2026-01-01T00:00:01Z"),
      },
    ],
    ...overrides,
  };
}

describe("mecha sessions", () => {
  let formatter: Formatter;
  let deps: CommandDeps;

  beforeEach(() => {
    formatter = createMockFormatter();
    deps = { dockerClient: { docker: {} } as any, formatter };
    process.exitCode = undefined;
    vi.clearAllMocks();
  });

  // --- sessions list ---

  it("sessions list calls mechaSessionList and outputs table", async () => {
    mockMechaSessionList.mockResolvedValueOnce({
      sessions: [makeSummary()],
      meta: {},
    });
    const program = new Command();
    registerSessionsCommand(program, deps);
    await program.parseAsync(["sessions", "list", "mx-test"], { from: "user" });

    expect(mockMechaSessionList).toHaveBeenCalledWith(deps.dockerClient, { id: "mx-test" });
    expect(formatter.table).toHaveBeenCalledWith(
      [expect.objectContaining({
        ID: "abcdef12",
        TITLE: "My Session",
        SLUG: "-home-mecha",
        MESSAGES: "5",
        MODEL: "claude-sonnet-4-6",
        STARRED: "",
      })],
      ["ID", "TITLE", "SLUG", "MESSAGES", "MODEL", "STARRED", "UPDATED"],
    );
  });

  it("sessions list applies custom title from meta and shows star", async () => {
    mockMechaSessionList.mockResolvedValueOnce({
      sessions: [makeSummary()],
      meta: { abcdef1234567890: { customTitle: "Custom Title", starred: true } },
    });
    const program = new Command();
    registerSessionsCommand(program, deps);
    await program.parseAsync(["sessions", "list", "mx-test"], { from: "user" });

    expect(formatter.table).toHaveBeenCalledWith(
      [expect.objectContaining({ TITLE: "Custom Title", STARRED: "*" })],
      expect.any(Array),
    );
  });

  it("sessions list shows (no results) for empty list", async () => {
    mockMechaSessionList.mockResolvedValueOnce({ sessions: [], meta: {} });
    const program = new Command();
    registerSessionsCommand(program, deps);
    await program.parseAsync(["sessions", "list", "mx-test"], { from: "user" });

    expect(formatter.table).toHaveBeenCalledWith([], expect.any(Array));
  });

  it("sessions list reports error on failure", async () => {
    mockMechaSessionList.mockRejectedValueOnce(new Error("connection refused"));
    const program = new Command();
    registerSessionsCommand(program, deps);
    await program.parseAsync(["sessions", "list", "mx-test"], { from: "user" });

    expect(formatter.error).toHaveBeenCalledWith(expect.stringContaining("connection refused"));
    expect(process.exitCode).toBe(1);
  });

  it("sessions list handles missing model gracefully", async () => {
    mockMechaSessionList.mockResolvedValueOnce({
      sessions: [makeSummary({ model: undefined })],
      meta: {},
    });
    const program = new Command();
    registerSessionsCommand(program, deps);
    await program.parseAsync(["sessions", "list", "mx-test"], { from: "user" });

    expect(formatter.table).toHaveBeenCalledWith(
      [expect.objectContaining({ MODEL: "-" })],
      expect.any(Array),
    );
  });

  it("sessions list --node gpu calls remoteSessionList", async () => {
    const target = { node: "gpu", entry: { name: "gpu", host: "http://gpu:7660", key: "k1" } };
    mockResolveTarget.mockResolvedValueOnce(target);
    mockRemoteSessionList.mockResolvedValueOnce({
      sessions: [makeSummary()],
      meta: {},
    });
    const program = new Command();
    registerSessionsCommand(program, deps);
    await program.parseAsync(["sessions", "list", "mx-test", "--node", "gpu"], { from: "user" });

    expect(mockResolveTarget).toHaveBeenCalledWith(deps.dockerClient, "mx-test", "gpu");
    expect(mockRemoteSessionList).toHaveBeenCalledWith(deps.dockerClient, "mx-test", target);
    expect(mockMechaSessionList).not.toHaveBeenCalled();
    expect(formatter.table).toHaveBeenCalled();
  });

  it("sessions list --node bad reports error", async () => {
    mockResolveTarget.mockRejectedValueOnce(new Error('Node "bad" not found in node registry'));
    const program = new Command();
    registerSessionsCommand(program, deps);
    await program.parseAsync(["sessions", "list", "mx-test", "--node", "bad"], { from: "user" });

    expect(formatter.error).toHaveBeenCalledWith(expect.stringContaining("not found in node registry"));
    expect(process.exitCode).toBe(1);
  });

  // --- sessions show ---

  it("sessions show displays session details and messages", async () => {
    mockMechaSessionGet.mockResolvedValueOnce(makeSession());
    const program = new Command();
    registerSessionsCommand(program, deps);
    await program.parseAsync(["sessions", "show", "mx-test", "sess-abc"], { from: "user" });

    expect(mockMechaSessionGet).toHaveBeenCalledWith(deps.dockerClient, { id: "mx-test", sessionId: "sess-abc" });
    expect(formatter.info).toHaveBeenCalledWith("Session: sess-abc");
    expect(formatter.info).toHaveBeenCalledWith("Project: -home-mecha");
    expect(formatter.info).toHaveBeenCalledWith("Title: Test Session");
    expect(formatter.info).toHaveBeenCalledWith("Messages: 2");
    expect(formatter.info).toHaveBeenCalledWith("---");
    // Summarized content: thinking, text, tool_use
    expect(formatter.info).toHaveBeenCalledWith(expect.stringContaining("[user] Hello"));
    expect(formatter.info).toHaveBeenCalledWith(expect.stringContaining("[thinking:"));
    expect(formatter.info).toHaveBeenCalledWith(expect.stringContaining("[tool: Read]"));
  });

  it("sessions show summarizes tool_result blocks", async () => {
    mockMechaSessionGet.mockResolvedValueOnce(makeSession({
      messages: [{
        uuid: "a1",
        parentUuid: null,
        role: "assistant",
        content: [{ type: "tool_result", tool_use_id: "t1", content: "result data" }],
        timestamp: new Date("2026-01-01T00:00:00Z"),
      }],
      messageCount: 1,
    }));
    const program = new Command();
    registerSessionsCommand(program, deps);
    await program.parseAsync(["sessions", "show", "mx-test", "sess-abc"], { from: "user" });

    expect(formatter.info).toHaveBeenCalledWith("[assistant] [tool_result]");
  });

  it("sessions show --raw outputs JSON content blocks", async () => {
    mockMechaSessionGet.mockResolvedValueOnce(makeSession());
    const program = new Command();
    registerSessionsCommand(program, deps);
    await program.parseAsync(["sessions", "show", "mx-test", "sess-abc", "--raw"], { from: "user" });

    // Raw mode outputs JSON.stringify(content)
    expect(formatter.info).toHaveBeenCalledWith(expect.stringContaining('"type":"text"'));
  });

  it("sessions show handles empty session", async () => {
    mockMechaSessionGet.mockResolvedValueOnce(makeSession({
      title: "(untitled)",
      messageCount: 0,
      model: undefined,
      messages: [],
    }));
    const program = new Command();
    registerSessionsCommand(program, deps);
    await program.parseAsync(["sessions", "show", "mx-test", "sess-abc"], { from: "user" });

    expect(formatter.info).toHaveBeenCalledWith("Title: (untitled)");
    expect(formatter.info).toHaveBeenCalledWith("Model: (unknown)");
    // Should not have "---" separator when no messages
    const infoCalls = (formatter.info as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0]);
    expect(infoCalls).not.toContain("---");
  });

  it("sessions show reports error on failure", async () => {
    mockMechaSessionGet.mockRejectedValueOnce(new Error("not found"));
    const program = new Command();
    registerSessionsCommand(program, deps);
    await program.parseAsync(["sessions", "show", "mx-test", "sess-bad"], { from: "user" });

    expect(formatter.error).toHaveBeenCalledWith(expect.stringContaining("not found"));
    expect(process.exitCode).toBe(1);
  });

  it("sessions show --node gpu calls remoteSessionGet", async () => {
    const target = { node: "gpu", entry: { name: "gpu", host: "http://gpu:7660", key: "k1" } };
    mockResolveTarget.mockResolvedValueOnce(target);
    mockRemoteSessionGet.mockResolvedValueOnce(makeSession());
    const program = new Command();
    registerSessionsCommand(program, deps);
    await program.parseAsync(["sessions", "show", "mx-test", "sess-abc", "--node", "gpu"], { from: "user" });

    expect(mockResolveTarget).toHaveBeenCalledWith(deps.dockerClient, "mx-test", "gpu");
    expect(mockRemoteSessionGet).toHaveBeenCalledWith(deps.dockerClient, "mx-test", "sess-abc", target);
    expect(mockMechaSessionGet).not.toHaveBeenCalled();
    expect(formatter.info).toHaveBeenCalledWith("Session: sess-abc");
  });

  // --- sessions delete ---

  it("sessions delete calls mechaSessionDelete and shows success", async () => {
    mockMechaSessionDelete.mockResolvedValueOnce(undefined);
    const program = new Command();
    registerSessionsCommand(program, deps);
    await program.parseAsync(["sessions", "delete", "mx-test", "sess-del"], { from: "user" });

    expect(mockMechaSessionDelete).toHaveBeenCalledWith(deps.dockerClient, { id: "mx-test", sessionId: "sess-del" });
    expect(formatter.success).toHaveBeenCalledWith("Session sess-del deleted");
  });

  it("sessions delete reports error on failure", async () => {
    mockMechaSessionDelete.mockRejectedValueOnce(new Error("delete failed"));
    const program = new Command();
    registerSessionsCommand(program, deps);
    await program.parseAsync(["sessions", "delete", "mx-test", "sess-del"], { from: "user" });

    expect(formatter.error).toHaveBeenCalledWith(expect.stringContaining("delete failed"));
    expect(process.exitCode).toBe(1);
  });

  it("sessions delete --node gpu calls remoteSessionDelete", async () => {
    const target = { node: "gpu", entry: { name: "gpu", host: "http://gpu:7660", key: "k1" } };
    mockResolveTarget.mockResolvedValueOnce(target);
    mockRemoteSessionDelete.mockResolvedValueOnce(undefined);
    const program = new Command();
    registerSessionsCommand(program, deps);
    await program.parseAsync(["sessions", "delete", "mx-test", "sess-del", "--node", "gpu"], { from: "user" });

    expect(mockResolveTarget).toHaveBeenCalledWith(deps.dockerClient, "mx-test", "gpu");
    expect(mockRemoteSessionDelete).toHaveBeenCalledWith(deps.dockerClient, "mx-test", "sess-del", target);
    expect(mockMechaSessionDelete).not.toHaveBeenCalled();
    expect(formatter.success).toHaveBeenCalledWith("Session sess-del deleted");
  });

  // --- sessions interrupt ---

  it("sessions interrupt shows success when interrupted", async () => {
    mockMechaSessionInterrupt.mockResolvedValueOnce({ interrupted: true });
    const program = new Command();
    registerSessionsCommand(program, deps);
    await program.parseAsync(["sessions", "interrupt", "mx-test", "sess-int"], { from: "user" });

    expect(mockMechaSessionInterrupt).toHaveBeenCalledWith(deps.dockerClient, { id: "mx-test", sessionId: "sess-int" });
    expect(formatter.success).toHaveBeenCalledWith("Session sess-int interrupted");
  });

  it("sessions interrupt shows 'was not busy' when not interrupted", async () => {
    mockMechaSessionInterrupt.mockResolvedValueOnce({ interrupted: false });
    const program = new Command();
    registerSessionsCommand(program, deps);
    await program.parseAsync(["sessions", "interrupt", "mx-test", "sess-int"], { from: "user" });

    expect(formatter.info).toHaveBeenCalledWith("Session sess-int was not busy");
  });

  it("sessions interrupt reports error on failure", async () => {
    mockMechaSessionInterrupt.mockRejectedValueOnce(new Error("interrupt failed"));
    const program = new Command();
    registerSessionsCommand(program, deps);
    await program.parseAsync(["sessions", "interrupt", "mx-test", "sess-int"], { from: "user" });

    expect(formatter.error).toHaveBeenCalledWith(expect.stringContaining("interrupt failed"));
    expect(process.exitCode).toBe(1);
  });

  // --- sessions rename ---

  it("sessions rename calls mechaSessionRename and shows success", async () => {
    mockMechaSessionRename.mockResolvedValueOnce({ title: "New Title" });
    const program = new Command();
    registerSessionsCommand(program, deps);
    await program.parseAsync(["sessions", "rename", "mx-test", "sess-ren", "New Title"], { from: "user" });

    expect(mockMechaSessionRename).toHaveBeenCalledWith(deps.dockerClient, { id: "mx-test", sessionId: "sess-ren", title: "New Title" });
    expect(formatter.success).toHaveBeenCalledWith('Session sess-ren renamed to "New Title"');
  });

  it("sessions rename reports error on failure", async () => {
    mockMechaSessionRename.mockRejectedValueOnce(new Error("rename failed"));
    const program = new Command();
    registerSessionsCommand(program, deps);
    await program.parseAsync(["sessions", "rename", "mx-test", "sess-ren", "Title"], { from: "user" });

    expect(formatter.error).toHaveBeenCalledWith(expect.stringContaining("rename failed"));
    expect(process.exitCode).toBe(1);
  });

  it("sessions rename --node gpu calls remoteSessionMetaUpdate", async () => {
    const target = { node: "gpu", entry: { name: "gpu", host: "http://gpu:7660", key: "k1" } };
    mockResolveTarget.mockResolvedValueOnce(target);
    mockRemoteSessionMetaUpdate.mockResolvedValueOnce(undefined);
    const program = new Command();
    registerSessionsCommand(program, deps);
    await program.parseAsync(["sessions", "rename", "mx-test", "sess-ren", "Remote Title", "--node", "gpu"], { from: "user" });

    expect(mockResolveTarget).toHaveBeenCalledWith(deps.dockerClient, "mx-test", "gpu");
    expect(mockRemoteSessionMetaUpdate).toHaveBeenCalledWith("mx-test", "sess-ren", { customTitle: "Remote Title" }, target);
    expect(mockMechaSessionRename).not.toHaveBeenCalled();
    expect(formatter.success).toHaveBeenCalledWith('Session sess-ren renamed to "Remote Title"');
  });

  // --- sessions star ---

  it("sessions star toggles starred to true when not starred", async () => {
    const target = { node: "local" };
    mockResolveTarget.mockResolvedValueOnce(target);
    mockRemoteSessionList.mockResolvedValueOnce({
      sessions: [makeSummary({ id: "sess-1" })],
      meta: {},
    });
    mockRemoteSessionMetaUpdate.mockResolvedValueOnce(undefined);
    const program = new Command();
    registerSessionsCommand(program, deps);
    await program.parseAsync(["sessions", "star", "mx-test", "sess-1"], { from: "user" });

    expect(mockRemoteSessionMetaUpdate).toHaveBeenCalledWith("mx-test", "sess-1", { starred: true }, target);
    expect(formatter.success).toHaveBeenCalledWith("Session sess-1 starred");
  });

  it("sessions star toggles starred to false when already starred", async () => {
    const target = { node: "local" };
    mockResolveTarget.mockResolvedValueOnce(target);
    mockRemoteSessionList.mockResolvedValueOnce({
      sessions: [makeSummary({ id: "sess-1" })],
      meta: { "sess-1": { starred: true } },
    });
    mockRemoteSessionMetaUpdate.mockResolvedValueOnce(undefined);
    const program = new Command();
    registerSessionsCommand(program, deps);
    await program.parseAsync(["sessions", "star", "mx-test", "sess-1"], { from: "user" });

    expect(mockRemoteSessionMetaUpdate).toHaveBeenCalledWith("mx-test", "sess-1", { starred: false }, target);
    expect(formatter.success).toHaveBeenCalledWith("Session sess-1 unstarred");
  });

  it("sessions star --node gpu calls remote", async () => {
    const target = { node: "gpu", entry: { name: "gpu", host: "http://gpu:7660", key: "k1" } };
    mockResolveTarget.mockResolvedValueOnce(target);
    mockRemoteSessionList.mockResolvedValueOnce({
      sessions: [makeSummary({ id: "sess-1" })],
      meta: {},
    });
    mockRemoteSessionMetaUpdate.mockResolvedValueOnce(undefined);
    const program = new Command();
    registerSessionsCommand(program, deps);
    await program.parseAsync(["sessions", "star", "mx-test", "sess-1", "--node", "gpu"], { from: "user" });

    expect(mockResolveTarget).toHaveBeenCalledWith(deps.dockerClient, "mx-test", "gpu");
    expect(mockRemoteSessionMetaUpdate).toHaveBeenCalledWith("mx-test", "sess-1", { starred: true }, target);
    expect(formatter.success).toHaveBeenCalledWith("Session sess-1 starred");
  });

  it("sessions star reports error on failure", async () => {
    mockResolveTarget.mockRejectedValueOnce(new Error("resolve failed"));
    const program = new Command();
    registerSessionsCommand(program, deps);
    await program.parseAsync(["sessions", "star", "mx-test", "sess-1"], { from: "user" });

    expect(formatter.error).toHaveBeenCalledWith(expect.stringContaining("resolve failed"));
    expect(process.exitCode).toBe(1);
  });

  // --- sessions config show ---

  it("sessions config show displays session info", async () => {
    mockMechaSessionGet.mockResolvedValueOnce(makeSession({ model: "claude-sonnet-4-6" }));
    const program = new Command();
    registerSessionsCommand(program, deps);
    await program.parseAsync(["sessions", "config", "show", "mx-test", "sess-cfg"], { from: "user" });

    expect(mockMechaSessionGet).toHaveBeenCalledWith(deps.dockerClient, { id: "mx-test", sessionId: "sess-cfg" });
    expect(formatter.info).toHaveBeenCalledWith("Model: claude-sonnet-4-6");
  });

  it("sessions config show shows defaults for missing model", async () => {
    mockMechaSessionGet.mockResolvedValueOnce(makeSession({ model: undefined }));
    const program = new Command();
    registerSessionsCommand(program, deps);
    await program.parseAsync(["sessions", "config", "show", "mx-test", "sess-cfg"], { from: "user" });

    expect(formatter.info).toHaveBeenCalledWith("Model: (default)");
  });

  it("sessions config show reports error on failure", async () => {
    mockMechaSessionGet.mockRejectedValueOnce(new Error("not found"));
    const program = new Command();
    registerSessionsCommand(program, deps);
    await program.parseAsync(["sessions", "config", "show", "mx-test", "sess-bad"], { from: "user" });

    expect(formatter.error).toHaveBeenCalledWith(expect.stringContaining("not found"));
    expect(process.exitCode).toBe(1);
  });

  // --- sessions config set ---

  it("sessions config set sends config update and shows success", async () => {
    mockMechaSessionConfigUpdate.mockResolvedValueOnce({ ok: true });
    const program = new Command();
    registerSessionsCommand(program, deps);
    await program.parseAsync([
      "sessions", "config", "set", "mx-test", "sess-cfg",
      "--model", "claude-opus-4-20250514",
    ], { from: "user" });

    expect(mockMechaSessionConfigUpdate).toHaveBeenCalledWith(deps.dockerClient, {
      id: "mx-test",
      sessionId: "sess-cfg",
      config: { model: "claude-opus-4-20250514" },
    });
    expect(formatter.success).toHaveBeenCalledWith("Session sess-cfg config updated");
  });

  it("sessions config set passes all options correctly", async () => {
    mockMechaSessionConfigUpdate.mockResolvedValueOnce({ ok: true });
    const program = new Command();
    registerSessionsCommand(program, deps);
    await program.parseAsync([
      "sessions", "config", "set", "mx-test", "sess-cfg",
      "--model", "claude-opus-4-20250514",
      "--permission-mode", "full-auto",
      "--system-prompt", "Be concise",
      "--max-turns", "20",
      "--max-budget", "10.5",
    ], { from: "user" });

    expect(mockMechaSessionConfigUpdate).toHaveBeenCalledWith(deps.dockerClient, {
      id: "mx-test",
      sessionId: "sess-cfg",
      config: {
        model: "claude-opus-4-20250514",
        permissionMode: "full-auto",
        systemPrompt: "Be concise",
        maxTurns: 20,
        maxBudgetUsd: 10.5,
      },
    });
    expect(formatter.success).toHaveBeenCalledWith("Session sess-cfg config updated");
  });

  it("sessions config set errors when no options provided", async () => {
    const program = new Command();
    registerSessionsCommand(program, deps);
    await program.parseAsync(["sessions", "config", "set", "mx-test", "sess-cfg"], { from: "user" });

    expect(mockMechaSessionConfigUpdate).not.toHaveBeenCalled();
    expect(formatter.error).toHaveBeenCalledWith(expect.stringContaining("No config options provided"));
    expect(process.exitCode).toBe(1);
  });

  it("sessions config set rejects invalid permission mode", async () => {
    const program = new Command();
    registerSessionsCommand(program, deps);
    await program.parseAsync([
      "sessions", "config", "set", "mx-test", "sess-cfg",
      "--permission-mode", "yolo",
    ], { from: "user" });

    expect(mockMechaSessionConfigUpdate).not.toHaveBeenCalled();
    expect(formatter.error).toHaveBeenCalledWith(expect.stringContaining('Invalid permission mode "yolo"'));
    expect(process.exitCode).toBe(1);
  });

  it("sessions config set rejects invalid max turns", async () => {
    const program = new Command();
    registerSessionsCommand(program, deps);
    await program.parseAsync([
      "sessions", "config", "set", "mx-test", "sess-cfg",
      "--max-turns", "abc",
    ], { from: "user" });

    expect(mockMechaSessionConfigUpdate).not.toHaveBeenCalled();
    expect(formatter.error).toHaveBeenCalledWith(expect.stringContaining('Invalid max turns "abc"'));
    expect(process.exitCode).toBe(1);
  });

  it("sessions config set rejects non-positive max turns", async () => {
    const program = new Command();
    registerSessionsCommand(program, deps);
    await program.parseAsync([
      "sessions", "config", "set", "mx-test", "sess-cfg",
      "--max-turns", "0",
    ], { from: "user" });

    expect(mockMechaSessionConfigUpdate).not.toHaveBeenCalled();
    expect(formatter.error).toHaveBeenCalledWith(expect.stringContaining('Invalid max turns "0"'));
    expect(process.exitCode).toBe(1);
  });

  it("sessions config set rejects invalid max budget", async () => {
    const program = new Command();
    registerSessionsCommand(program, deps);
    await program.parseAsync([
      "sessions", "config", "set", "mx-test", "sess-cfg",
      "--max-budget", "free",
    ], { from: "user" });

    expect(mockMechaSessionConfigUpdate).not.toHaveBeenCalled();
    expect(formatter.error).toHaveBeenCalledWith(expect.stringContaining('Invalid max budget "free"'));
    expect(process.exitCode).toBe(1);
  });

  it("sessions config set rejects non-positive max budget", async () => {
    const program = new Command();
    registerSessionsCommand(program, deps);
    await program.parseAsync([
      "sessions", "config", "set", "mx-test", "sess-cfg",
      "--max-budget", "0",
    ], { from: "user" });

    expect(mockMechaSessionConfigUpdate).not.toHaveBeenCalled();
    expect(formatter.error).toHaveBeenCalledWith(expect.stringContaining('Invalid max budget "0"'));
    expect(process.exitCode).toBe(1);
  });

  it("sessions config set reports error on failure", async () => {
    mockMechaSessionConfigUpdate.mockRejectedValueOnce(new Error("update failed"));
    const program = new Command();
    registerSessionsCommand(program, deps);
    await program.parseAsync([
      "sessions", "config", "set", "mx-test", "sess-cfg",
      "--model", "bad-model",
    ], { from: "user" });

    expect(formatter.error).toHaveBeenCalledWith(expect.stringContaining("update failed"));
    expect(process.exitCode).toBe(1);
  });
});
