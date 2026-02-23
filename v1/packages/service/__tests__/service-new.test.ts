import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ProcessManager, MechaProcessInfo, SpawnOpts } from "@mecha/process";
import {
  mechaToken,
  mechaEnv,
  mechaChat,
  mechaSessionCreate,
  mechaSessionList,
  mechaSessionGet,
  mechaSessionDelete,
  mechaSessionMessage,
  mechaSessionInterrupt,
  mechaSessionConfigUpdate,
  mechaSessionRename,
  getMechaPath,
} from "../src/service.js";
import {
  TokenNotFoundError,
  NoPortBindingError,
  ChatRequestFailedError,
  SessionNotFoundError,
  SessionBusyError,
  SessionCapReachedError,
} from "@mecha/contracts";
import { tmpdir } from "node:os";
import { PassThrough } from "node:stream";

// --- node:fs mock ---
const mockUnlinkSync = vi.fn();
const mockLstatSync = vi.fn().mockReturnValue({ isSymbolicLink: () => false });
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    unlinkSync: (...a: unknown[]) => mockUnlinkSync(...a),
    lstatSync: (...a: unknown[]) => mockLstatSync(...a),
  };
});

// --- @mecha/core filesystem mocks ---
const mockResolveProjectsDir = vi.fn().mockReturnValue("/mock/.claude/projects");
const mockListSessionFiles = vi.fn().mockReturnValue([]);
const mockParseSessionSummary = vi.fn().mockReturnValue({
  id: "s1", projectSlug: "-home", title: "test", messageCount: 1,
  model: "claude", createdAt: new Date(), updatedAt: new Date(),
});
const mockParseSessionFile = vi.fn().mockReturnValue({
  id: "s1", projectSlug: "-home", title: "test", messageCount: 1,
  model: "claude", createdAt: new Date(), updatedAt: new Date(), messages: [],
});
const mockGetAllSessionMeta = vi.fn().mockReturnValue({});
const mockSetSessionMeta = vi.fn();
const mockDeleteSessionMeta = vi.fn();

vi.mock("@mecha/core", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    resolveProjectsDir: (...a: unknown[]) => mockResolveProjectsDir(...a),
    listSessionFiles: (...a: unknown[]) => mockListSessionFiles(...a),
    parseSessionSummary: (...a: unknown[]) => mockParseSessionSummary(...a),
    parseSessionFile: (...a: unknown[]) => mockParseSessionFile(...a),
    getAllSessionMeta: (...a: unknown[]) => mockGetAllSessionMeta(...a),
    setSessionMeta: (...a: unknown[]) => mockSetSessionMeta(...a),
    deleteSessionMeta: (...a: unknown[]) => mockDeleteSessionMeta(...a),
  };
});

// --- ProcessManager mock ---
function createMockPM(overrides: Partial<ProcessManager> = {}): ProcessManager {
  const defaultInfo: MechaProcessInfo = {
    id: "mx-test-abc123" as any,
    pid: 12345,
    port: 7700,
    projectPath: tmpdir(),
    state: "running",
    authToken: "a".repeat(64),
    env: { MECHA_AUTH_TOKEN: "test-token" },
    createdAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    startFingerprint: "12345:0",
  };

  return {
    spawn: vi.fn<(opts: SpawnOpts) => Promise<MechaProcessInfo>>().mockResolvedValue(defaultInfo),
    stop: vi.fn<(id: string) => Promise<void>>().mockResolvedValue(undefined),
    kill: vi.fn<(id: string, force?: boolean) => Promise<void>>().mockResolvedValue(undefined),
    get: vi.fn<(id: string) => MechaProcessInfo | undefined>().mockReturnValue(defaultInfo),
    list: vi.fn<() => MechaProcessInfo[]>().mockReturnValue([defaultInfo]),
    logs: vi.fn<(id: string) => NodeJS.ReadableStream>().mockReturnValue(new PassThrough()),
    getPortAndEnv: vi.fn<(id: string) => { port: number | undefined; env: Record<string, string> }>()
      .mockReturnValue({ port: 7700, env: { MECHA_AUTH_TOKEN: "test-token" } }),
    onEvent: vi.fn<(handler: (event: any) => void) => () => void>().mockReturnValue(() => {}),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// --- mechaToken ---
describe("mechaToken", () => {
  it("returns token from process env", async () => {
    const pm = createMockPM({
      getPortAndEnv: vi.fn().mockReturnValue({
        port: 7700,
        env: { MECHA_AUTH_TOKEN: "my-token-123", PATH: "/usr/bin" },
      }),
    });
    const result = await mechaToken(pm, "mx-abc123");
    expect(result.token).toBe("my-token-123");
    expect(result.id).toBe("mx-abc123");
  });

  it("throws TokenNotFoundError when no token in env", async () => {
    const pm = createMockPM({
      getPortAndEnv: vi.fn().mockReturnValue({ port: 7700, env: { PATH: "/usr/bin" } }),
    });
    await expect(mechaToken(pm, "mx-abc")).rejects.toThrow(TokenNotFoundError);
  });

  it("throws TokenNotFoundError when env is empty", async () => {
    const pm = createMockPM({
      getPortAndEnv: vi.fn().mockReturnValue({ port: 7700, env: {} }),
    });
    await expect(mechaToken(pm, "mx-abc")).rejects.toThrow(TokenNotFoundError);
  });
});

// --- mechaEnv ---
describe("mechaEnv", () => {
  it("returns environment variables as key-value pairs", async () => {
    const pm = createMockPM({
      getPortAndEnv: vi.fn().mockReturnValue({
        port: 7700,
        env: { FOO: "bar", BAZ: "qux" },
      }),
    });
    const result = await mechaEnv(pm, "mx-abc");
    expect(result.env).toEqual([
      { key: "FOO", value: "bar" },
      { key: "BAZ", value: "qux" },
    ]);
  });

  it("handles empty env", async () => {
    const pm = createMockPM({
      getPortAndEnv: vi.fn().mockReturnValue({ port: 7700, env: {} }),
    });
    const result = await mechaEnv(pm, "mx-abc");
    expect(result.env).toEqual([]);
  });
});

// --- mechaChat ---
describe("mechaChat", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends chat request and returns response", async () => {
    const pm = createMockPM();
    const mockResponse = { ok: true, body: null } as unknown as Response;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(mockResponse));
    const res = await mechaChat(pm, { id: "mx-abc", message: "hello" });
    expect(res).toBe(mockResponse);
    const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(fetchCall[0]).toBe("http://127.0.0.1:7700/api/chat");
    expect(fetchCall[1].headers.Authorization).toBe("Bearer test-token");
  });

  it("throws TokenNotFoundError when no token env", async () => {
    const pm = createMockPM({
      getPortAndEnv: vi.fn().mockReturnValue({ port: 7700, env: {} }),
    });
    await expect(mechaChat(pm, { id: "mx-abc", message: "hello" })).rejects.toThrow(TokenNotFoundError);
  });

  it("throws when no port binding", async () => {
    const pm = createMockPM({
      getPortAndEnv: vi.fn().mockReturnValue({ port: undefined, env: {} }),
    });
    await expect(mechaChat(pm, { id: "mx-abc", message: "hi" })).rejects.toThrow(NoPortBindingError);
  });

  it("aborts on timeout", async () => {
    const pm = createMockPM();
    const abortError = new DOMException("The operation was aborted", "AbortError");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(abortError));
    await expect(mechaChat(pm, { id: "mx-abc", message: "hi" })).rejects.toThrow("aborted");
  });

  it("throws on non-ok response", async () => {
    const pm = createMockPM();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({ ok: false, status: 500, statusText: "Internal" }));
    await expect(mechaChat(pm, { id: "mx-abc", message: "hi" })).rejects.toThrow(ChatRequestFailedError);
  });
});

// --- getRuntimeAccess error paths (tested via session functions) ---
describe("getRuntimeAccess error paths", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("throws NoPortBindingError when no port", async () => {
    const pm = createMockPM({
      getPortAndEnv: vi.fn().mockReturnValue({ port: undefined, env: {} }),
    });
    await expect(mechaSessionCreate(pm, { id: "mx-abc" })).rejects.toThrow(NoPortBindingError);
  });

  it("throws TokenNotFoundError when no token env", async () => {
    const pm = createMockPM({
      getPortAndEnv: vi.fn().mockReturnValue({ port: 7700, env: {} }),
    });
    await expect(mechaSessionCreate(pm, { id: "mx-abc" })).rejects.toThrow(TokenNotFoundError);
  });

  it("throws TokenNotFoundError when env has no token entry", async () => {
    const pm = createMockPM({
      getPortAndEnv: vi.fn().mockReturnValue({ port: 7700, env: { OTHER: "val" } }),
    });
    await expect(mechaSessionCreate(pm, { id: "mx-abc" })).rejects.toThrow(TokenNotFoundError);
  });
});

// --- mapSessionError fallback ---
describe("mapSessionError fallback", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("throws generic Error for unmapped status codes", async () => {
    const pm = createMockPM();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve("Server Error"),
    }));
    await expect(mechaSessionCreate(pm, { id: "mx-abc" })).rejects.toThrow("Session request failed: 500 Server Error");
  });
});

// --- mechaSessionCreate ---
describe("mechaSessionCreate", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends POST to /api/sessions with auth and body, returns parsed JSON", async () => {
    const pm = createMockPM();
    const responseBody = { sessionId: "sess-new-123" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(responseBody),
    }));
    const result = await mechaSessionCreate(pm, { id: "mx-abc", title: "My Session" });
    expect(result).toEqual(responseBody);
    const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(fetchCall[0]).toBe("http://127.0.0.1:7700/api/sessions");
    expect(fetchCall[1].method).toBe("POST");
    expect(fetchCall[1].headers.get("Authorization")).toBe("Bearer test-token");
    expect(JSON.parse(fetchCall[1].body)).toHaveProperty("title", "My Session");
  });

  it("throws SessionCapReachedError on 429", async () => {
    const pm = createMockPM();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: () => Promise.resolve("Too many sessions"),
    }));
    await expect(mechaSessionCreate(pm, { id: "mx-abc" })).rejects.toThrow(SessionCapReachedError);
  });

  it("throws SessionNotFoundError with 'unknown' when no sessionId on 404", async () => {
    const pm = createMockPM();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: () => Promise.resolve("Not found"),
    }));
    try {
      await mechaSessionCreate(pm, { id: "mx-abc" });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(SessionNotFoundError);
      expect((err as Error).message).toContain("unknown");
    }
  });

  it("throws SessionBusyError with 'unknown' when no sessionId on 409", async () => {
    const pm = createMockPM();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 409,
      text: () => Promise.resolve("Busy"),
    }));
    try {
      await mechaSessionCreate(pm, { id: "mx-abc" });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(SessionBusyError);
      expect((err as Error).message).toContain("unknown");
    }
  });
});

// --- getMechaPath ---
describe("getMechaPath", () => {
  it("returns path from process state", () => {
    const info = {
      id: "mx-abc" as any,
      pid: 123,
      port: 7700,
      projectPath: "/home/user/project",
      state: "running" as const,
      authToken: "tok",
      env: {},
      createdAt: new Date().toISOString(),
      startFingerprint: "123:0",
    };
    const pm = createMockPM({ get: vi.fn().mockReturnValue(info) });
    const path = getMechaPath(pm, "mx-abc");
    expect(path).toBe("/home/user/project");
  });

  it("throws when mecha not found", () => {
    const pm = createMockPM({ get: vi.fn().mockReturnValue(undefined) });
    expect(() => getMechaPath(pm, "mx-abc")).toThrow("Mecha not found");
  });
});

// --- mechaSessionList (filesystem-based) ---
describe("mechaSessionList", () => {
  it("returns sessions from filesystem and metadata", async () => {
    const pm = createMockPM();
    const summary = {
      id: "s1", projectSlug: "-home", title: "test", messageCount: 1,
      model: "claude", createdAt: new Date(), updatedAt: new Date(),
    };
    mockListSessionFiles.mockReturnValue([{ sessionId: "s1", filePath: "/path/s1.jsonl", projectSlug: "-home" }]);
    mockParseSessionSummary.mockReturnValue(summary);
    mockGetAllSessionMeta.mockReturnValue({ s1: { starred: true } });

    const result = await mechaSessionList(pm, { id: "mx-abc" });

    expect(result.sessions).toEqual([summary]);
    expect(result.meta).toEqual({ s1: { starred: true } });
  });

  it("returns empty when no session files exist", async () => {
    const pm = createMockPM();
    mockListSessionFiles.mockReturnValue([]);
    mockGetAllSessionMeta.mockReturnValue({});
    const result = await mechaSessionList(pm, { id: "mx-abc" });
    expect(result.sessions).toEqual([]);
    expect(result.meta).toEqual({});
  });
});

// --- mechaSessionGet (filesystem-based) ---
describe("mechaSessionGet", () => {
  it("returns parsed session for matching ID", async () => {
    const pm = createMockPM();
    const parsed = {
      id: "sess-abc", projectSlug: "-home", title: "Test", messageCount: 0,
      model: "claude", createdAt: new Date(), updatedAt: new Date(), messages: [],
    };
    mockListSessionFiles.mockReturnValue([{ sessionId: "sess-abc", filePath: "/path/sess-abc.jsonl", projectSlug: "-home" }]);
    mockParseSessionFile.mockReturnValue(parsed);

    const result = await mechaSessionGet(pm, { id: "mx-abc", sessionId: "sess-abc" });
    expect(result).toEqual(parsed);
  });

  it("throws SessionNotFoundError when session file not found", async () => {
    const pm = createMockPM();
    mockListSessionFiles.mockReturnValue([]);
    await expect(mechaSessionGet(pm, { id: "mx-abc", sessionId: "bad-sess" })).rejects.toThrow(SessionNotFoundError);
  });
});

// --- mechaSessionDelete (filesystem + best-effort runtime) ---
describe("mechaSessionDelete", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("deletes JSONL file and attempts runtime cleanup", async () => {
    const pm = createMockPM();
    mockListSessionFiles.mockReturnValue([{ sessionId: "sess-del", filePath: "/path/sess-del.jsonl", projectSlug: "-home" }]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({ ok: true, status: 204 }));

    await expect(mechaSessionDelete(pm, { id: "mx-abc", sessionId: "sess-del" })).resolves.toBeUndefined();
    expect(mockUnlinkSync).toHaveBeenCalledWith("/path/sess-del.jsonl");
    expect(mockDeleteSessionMeta).toHaveBeenCalledWith("mx-abc", "sess-del");
  });

  it("throws SessionNotFoundError when session file not found", async () => {
    const pm = createMockPM();
    mockListSessionFiles.mockReturnValue([]);
    await expect(mechaSessionDelete(pm, { id: "mx-abc", sessionId: "bad-sess" })).rejects.toThrow(SessionNotFoundError);
  });

  it("rejects symlinked session files", async () => {
    const pm = createMockPM();
    mockListSessionFiles.mockReturnValue([{ sessionId: "sess-sym", filePath: "/path/sess-sym.jsonl", projectSlug: "-home" }]);
    mockLstatSync.mockReturnValueOnce({ isSymbolicLink: () => true });
    await expect(mechaSessionDelete(pm, { id: "mx-abc", sessionId: "sess-sym" })).rejects.toThrow("Refusing to delete symlinked session file");
    expect(mockUnlinkSync).not.toHaveBeenCalled();
  });

  it("ignores fetch failed from runtime cleanup", async () => {
    const pm = createMockPM();
    mockListSessionFiles.mockReturnValue([{ sessionId: "sess-del2", filePath: "/path/sess-del2.jsonl", projectSlug: "-home" }]);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new Error("fetch failed")));
    await expect(mechaSessionDelete(pm, { id: "mx-abc", sessionId: "sess-del2" })).resolves.toBeUndefined();
    expect(mockUnlinkSync).toHaveBeenCalledWith("/path/sess-del2.jsonl");
    expect(mockDeleteSessionMeta).toHaveBeenCalledWith("mx-abc", "sess-del2");
  });

  it("rethrows non-connection errors from runtime cleanup", async () => {
    const pm = createMockPM();
    mockListSessionFiles.mockReturnValue([{ sessionId: "sess-del3", filePath: "/path/sess-del3.jsonl", projectSlug: "-home" }]);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new Error("Internal server error")));
    await expect(mechaSessionDelete(pm, { id: "mx-abc", sessionId: "sess-del3" })).rejects.toThrow("Internal server error");
  });

  it("rethrows non-Error thrown values from runtime cleanup", async () => {
    const pm = createMockPM();
    mockListSessionFiles.mockReturnValue([{ sessionId: "sess-del4", filePath: "/path/sess-del4.jsonl", projectSlug: "-home" }]);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce("string error"));
    await expect(mechaSessionDelete(pm, { id: "mx-abc", sessionId: "sess-del4" })).rejects.toBe("string error");
  });
});

// --- mechaSessionMessage ---
describe("mechaSessionMessage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns Response with body stream", async () => {
    const pm = createMockPM();
    const mockBody = new ReadableStream();
    const mockResponse = { ok: true, body: mockBody } as unknown as Response;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(mockResponse));
    const res = await mechaSessionMessage(pm, { id: "mx-abc", sessionId: "sess-1", message: "hello" });
    expect(res).toBe(mockResponse);
    expect(res.body).toBe(mockBody);
    const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(fetchCall[0]).toBe("http://127.0.0.1:7700/api/sessions/sess-1/message");
    expect(fetchCall[1].method).toBe("POST");
    expect(JSON.parse(fetchCall[1].body)).toEqual({ message: "hello" });
  });

  it("throws SessionBusyError on 409", async () => {
    const pm = createMockPM();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 409,
      text: () => Promise.resolve("Busy"),
    }));
    await expect(mechaSessionMessage(pm, { id: "mx-abc", sessionId: "sess-1", message: "hi" })).rejects.toThrow(SessionBusyError);
  });
});

// --- mechaSessionInterrupt ---
describe("mechaSessionInterrupt", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("throws SessionNotFoundError on 404", async () => {
    const pm = createMockPM();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: () => Promise.resolve("Not found"),
    }));
    await expect(mechaSessionInterrupt(pm, { id: "mx-abc", sessionId: "bad-sess" })).rejects.toThrow(SessionNotFoundError);
  });

  it("sends POST and returns { interrupted: true }", async () => {
    const pm = createMockPM();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ interrupted: true }),
    }));
    const result = await mechaSessionInterrupt(pm, { id: "mx-abc", sessionId: "sess-int" });
    expect(result).toEqual({ interrupted: true });
    const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(fetchCall[0]).toBe("http://127.0.0.1:7700/api/sessions/sess-int/interrupt");
    expect(fetchCall[1].method).toBe("POST");
  });
});

// --- mechaSessionRename (metadata-based) ---
describe("mechaSessionRename", () => {
  beforeEach(() => {
    mockListSessionFiles.mockReturnValue([{ sessionId: "sess-1", filePath: "/path/sess-1.jsonl", projectSlug: "-home" }]);
  });

  it("sets metadata and returns title", async () => {
    const pm = createMockPM();
    const result = await mechaSessionRename(pm, { id: "mx-abc", sessionId: "sess-1", title: "New Title" });
    expect(result).toEqual({ title: "New Title" });
    expect(mockSetSessionMeta).toHaveBeenCalledWith("mx-abc", "sess-1", { customTitle: "New Title" });
  });

  it("throws SessionNotFoundError when session file not found", async () => {
    const pm = createMockPM();
    mockListSessionFiles.mockReturnValue([]);
    await expect(mechaSessionRename(pm, { id: "mx-abc", sessionId: "bad-sess", title: "Title" })).rejects.toThrow(SessionNotFoundError);
  });
});

// --- mechaSessionConfigUpdate ---
describe("mechaSessionConfigUpdate", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("throws SessionBusyError on 409", async () => {
    const pm = createMockPM();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 409,
      text: () => Promise.resolve("Busy"),
    }));
    await expect(mechaSessionConfigUpdate(pm, { id: "mx-abc", sessionId: "busy-sess", config: { maxTurns: 10 } })).rejects.toThrow(SessionBusyError);
  });

  it("sends PUT with config body", async () => {
    const pm = createMockPM();
    const config = { model: "claude-3", maxTokens: 1000 };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    }));
    const result = await mechaSessionConfigUpdate(pm, { id: "mx-abc", sessionId: "sess-cfg", config });
    expect(result).toEqual({ ok: true });
    const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(fetchCall[0]).toBe("http://127.0.0.1:7700/api/sessions/sess-cfg/config");
    expect(fetchCall[1].method).toBe("PUT");
    expect(fetchCall[1].headers.get("Content-Type")).toBe("application/json");
    expect(JSON.parse(fetchCall[1].body)).toEqual(config);
  });

  it("mapSessionError maps 400 to Error with body", async () => {
    const pm = createMockPM();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: () => Promise.resolve("Invalid config"),
    }));
    await expect(mechaSessionCreate(pm, { id: "mx-abc" })).rejects.toThrow("Bad request: Invalid config");
  });

  it("mapSessionError maps 503 to Error with body", async () => {
    const pm = createMockPM();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: () => Promise.resolve("Sessions not available"),
    }));
    await expect(mechaSessionCreate(pm, { id: "mx-abc" })).rejects.toThrow("Service unavailable: Sessions not available");
  });
});
