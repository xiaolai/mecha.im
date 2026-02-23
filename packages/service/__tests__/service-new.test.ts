import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { DockerClient } from "@mecha/docker";
import {
  mechaToken,
  mechaInspect,
  mechaEnv,
  mechaPrune,
  mechaUpdate,
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

// --- Mocks ---
const mockEnsureNetwork = vi.fn().mockResolvedValue(undefined);
const mockEnsureVolume = vi.fn().mockResolvedValue(undefined);
const mockRemoveVolume = vi.fn().mockResolvedValue(undefined);
const mockCreateContainer = vi.fn().mockResolvedValue({ id: "abc" });
const mockGetContainerPort = vi.fn().mockResolvedValue(7700);
const mockGetContainerPortAndEnv = vi.fn().mockResolvedValue({ port: 7700, env: [] });
const mockStartContainer = vi.fn().mockResolvedValue(undefined);
const mockStopContainer = vi.fn().mockResolvedValue(undefined);
const mockRemoveContainer = vi.fn().mockResolvedValue(undefined);
const mockInspectContainer = vi.fn().mockResolvedValue({});
const mockListMechaContainers = vi.fn().mockResolvedValue([]);
const mockGetContainerLogs = vi.fn();
const mockExecInContainer = vi.fn();
const mockPing = vi.fn();
const mockPullImage = vi.fn().mockResolvedValue(undefined);

vi.mock("@mecha/docker", () => ({
  ensureNetwork: (...a: unknown[]) => mockEnsureNetwork(...a),
  ensureVolume: (...a: unknown[]) => mockEnsureVolume(...a),
  removeVolume: (...a: unknown[]) => mockRemoveVolume(...a),
  createContainer: (...a: unknown[]) => mockCreateContainer(...a),
  getContainerPort: (...a: unknown[]) => mockGetContainerPort(...a),
  getContainerPortAndEnv: (...a: unknown[]) => mockGetContainerPortAndEnv(...a),
  startContainer: (...a: unknown[]) => mockStartContainer(...a),
  stopContainer: (...a: unknown[]) => mockStopContainer(...a),
  removeContainer: (...a: unknown[]) => mockRemoveContainer(...a),
  inspectContainer: (...a: unknown[]) => mockInspectContainer(...a),
  listMechaContainers: (...a: unknown[]) => mockListMechaContainers(...a),
  getContainerLogs: (...a: unknown[]) => mockGetContainerLogs(...a),
  execInContainer: (...a: unknown[]) => mockExecInContainer(...a),
  ping: (...a: unknown[]) => mockPing(...a),
  pullImage: (...a: unknown[]) => mockPullImage(...a),
}));

const client = {} as DockerClient;

beforeEach(() => {
  vi.clearAllMocks();
  mockInspectContainer.mockResolvedValue({});
  mockGetContainerPort.mockResolvedValue(7700);
  mockGetContainerPortAndEnv.mockResolvedValue({ port: 7700, env: [] });
  mockListMechaContainers.mockResolvedValue([]);
  mockPullImage.mockResolvedValue(undefined);
  mockRemoveContainer.mockResolvedValue(undefined);
  mockCreateContainer.mockResolvedValue({ id: "abc" });
  mockStartContainer.mockResolvedValue(undefined);
  mockStopContainer.mockResolvedValue(undefined);
  mockRemoveVolume.mockResolvedValue(undefined);
});

// --- mechaToken ---
describe("mechaToken", () => {
  it("returns token from container env", async () => {
    mockGetContainerPortAndEnv.mockResolvedValueOnce({
      port: 7700,
      env: ["PATH=/usr/bin", "MECHA_AUTH_TOKEN=my-token-123"],
    });
    const result = await mechaToken(client, "mx-abc123");
    expect(result.token).toBe("my-token-123");
    expect(result.id).toBe("mx-abc123");
  });

  it("handles token values containing equals signs", async () => {
    mockGetContainerPortAndEnv.mockResolvedValueOnce({
      port: 7700,
      env: ["MECHA_AUTH_TOKEN=abc=def=ghi"],
    });
    const result = await mechaToken(client, "mx-abc");
    expect(result.token).toBe("abc=def=ghi");
  });

  it("throws TokenNotFoundError when no token env", async () => {
    mockGetContainerPortAndEnv.mockResolvedValueOnce({
      port: 7700,
      env: ["PATH=/usr/bin"],
    });
    await expect(mechaToken(client, "mx-abc")).rejects.toThrow(TokenNotFoundError);
  });

  it("throws TokenNotFoundError when Env is empty", async () => {
    mockGetContainerPortAndEnv.mockResolvedValueOnce({ port: 7700, env: [] });
    await expect(mechaToken(client, "mx-abc")).rejects.toThrow(TokenNotFoundError);
  });

  it("throws TokenNotFoundError when env has unrelated vars only", async () => {
    mockGetContainerPortAndEnv.mockResolvedValueOnce({ port: 7700, env: ["OTHER=val"] });
    await expect(mechaToken(client, "mx-abc")).rejects.toThrow(TokenNotFoundError);
  });
});

// --- mechaInspect ---
describe("mechaInspect", () => {
  it("returns raw inspect data", async () => {
    const fakeInfo = { Id: "abc", State: { Status: "running" } };
    mockInspectContainer.mockResolvedValueOnce(fakeInfo);
    const result = await mechaInspect(client, "mx-abc");
    expect(result).toEqual(fakeInfo);
  });
});

// --- mechaEnv ---
describe("mechaEnv", () => {
  it("parses environment variables", async () => {
    mockInspectContainer.mockResolvedValueOnce({
      Config: { Env: ["FOO=bar", "BAZ=qux=extra"] },
    });
    const result = await mechaEnv(client, "mx-abc");
    expect(result.env).toEqual([
      { key: "FOO", value: "bar" },
      { key: "BAZ", value: "qux=extra" },
    ]);
  });

  it("handles env entry without equals sign", async () => {
    mockInspectContainer.mockResolvedValueOnce({
      Config: { Env: ["NOEQUALS"] },
    });
    const result = await mechaEnv(client, "mx-abc");
    expect(result.env).toEqual([{ key: "NOEQUALS", value: "" }]);
  });

  it("handles empty env", async () => {
    mockInspectContainer.mockResolvedValueOnce({ Config: {} });
    const result = await mechaEnv(client, "mx-abc");
    expect(result.env).toEqual([]);
  });
});

// --- mechaPrune ---
describe("mechaPrune", () => {
  it("removes stopped containers only", async () => {
    mockListMechaContainers.mockResolvedValueOnce([
      { State: "exited", Names: ["/mecha-a"], Labels: { "mecha.id": "id-a" } },
      { State: "running", Names: ["/mecha-b"], Labels: { "mecha.id": "id-b" } },
      { State: "exited", Names: ["/mecha-c"], Labels: { "mecha.id": "id-c" } },
    ]);
    const result = await mechaPrune(client, {});
    expect(result.removedContainers).toEqual(["mecha-a", "mecha-c"]);
    expect(result.removedVolumes).toEqual([]);
    expect(mockRemoveContainer).toHaveBeenCalledTimes(2);
  });

  it("removes volumes when requested", async () => {
    mockListMechaContainers.mockResolvedValueOnce([
      { State: "exited", Names: ["/mecha-a"], Labels: { "mecha.id": "id-a" } },
    ]);
    const result = await mechaPrune(client, { volumes: true });
    expect(result.removedContainers).toEqual(["mecha-a"]);
    expect(result.removedVolumes).toEqual(["mecha-state-id-a"]);
    expect(mockRemoveVolume).toHaveBeenCalledTimes(1);
  });

  it("handles empty list", async () => {
    const result = await mechaPrune(client, {});
    expect(result.removedContainers).toEqual([]);
    expect(result.removedVolumes).toEqual([]);
  });

  it("continues on remove errors (best effort)", async () => {
    mockListMechaContainers.mockResolvedValueOnce([
      { State: "exited", Names: ["/mecha-a"], Labels: { "mecha.id": "id-a" } },
      { State: "exited", Names: ["/mecha-b"], Labels: { "mecha.id": "id-b" } },
    ]);
    mockRemoveContainer.mockRejectedValueOnce(new Error("fail")).mockResolvedValueOnce(undefined);
    const result = await mechaPrune(client, {});
    expect(result.removedContainers).toEqual(["mecha-b"]);
  });

  it("continues on volume remove errors", async () => {
    mockListMechaContainers.mockResolvedValueOnce([
      { State: "exited", Names: ["/mecha-a"], Labels: { "mecha.id": "id-a" } },
    ]);
    mockRemoveVolume.mockRejectedValueOnce(new Error("fail"));
    const result = await mechaPrune(client, { volumes: true });
    expect(result.removedContainers).toEqual(["mecha-a"]);
    expect(result.removedVolumes).toEqual([]);
  });

  it("skips containers with empty Names array", async () => {
    mockListMechaContainers.mockResolvedValueOnce([
      { State: "exited", Names: [], Labels: { "mecha.id": "id-a" } },
    ]);
    const result = await mechaPrune(client, {});
    expect(result.removedContainers).toEqual([]);
    expect(mockRemoveContainer).not.toHaveBeenCalled();
  });

  it("skips volume removal if no mecha id label", async () => {
    mockListMechaContainers.mockResolvedValueOnce([
      { State: "exited", Names: ["/mecha-a"], Labels: {} },
    ]);
    const result = await mechaPrune(client, { volumes: true });
    expect(result.removedContainers).toEqual(["mecha-a"]);
    expect(mockRemoveVolume).not.toHaveBeenCalled();
  });
});

// --- mechaUpdate ---
describe("mechaUpdate", () => {
  const fakeInspect = {
    Config: {
      Image: "mecha-runtime:old",
      Labels: { "mecha.path": "/home/user/project" },
      Env: ["MECHA_AUTH_TOKEN=token123"],
    },
    NetworkSettings: { Ports: { "3000/tcp": [{ HostPort: "7700" }] } },
    Mounts: [{ Destination: "/var/lib/mecha", Name: "mecha-vol-abc" }],
  };

  it("pulls image and recreates container", async () => {
    mockInspectContainer.mockResolvedValueOnce(fakeInspect);
    const result = await mechaUpdate(client, { id: "mx-abc" });
    expect(mockPullImage).toHaveBeenCalledTimes(1);
    expect(mockStopContainer).toHaveBeenCalled();
    expect(mockRemoveContainer).toHaveBeenCalled();
    expect(mockCreateContainer).toHaveBeenCalled();
    expect(mockStartContainer).toHaveBeenCalled();
    expect(result.previousImage).toBe("mecha-runtime:old");
  });

  it("skips pull with noPull option", async () => {
    mockInspectContainer.mockResolvedValueOnce(fakeInspect);
    await mechaUpdate(client, { id: "mx-abc", noPull: true });
    expect(mockPullImage).not.toHaveBeenCalled();
  });
});

// --- mechaChat ---
describe("mechaChat", () => {
  it("sends chat request and returns response", async () => {
    mockGetContainerPortAndEnv.mockResolvedValueOnce({
      port: 7700,
      env: ["MECHA_AUTH_TOKEN=tok123"],
    });
    const mockResponse = { ok: true, body: null } as unknown as Response;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(mockResponse));
    const res = await mechaChat(client, { id: "mx-abc", message: "hello" });
    expect(res).toBe(mockResponse);
    const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(fetchCall[0]).toBe("http://127.0.0.1:7700/api/chat");
    expect(fetchCall[1].headers.Authorization).toBe("Bearer tok123");
    vi.unstubAllGlobals();
  });

  it("throws TokenNotFoundError when no token env", async () => {
    mockGetContainerPortAndEnv.mockResolvedValueOnce({
      port: 7700,
      env: ["PATH=/usr/bin"],
    });
    await expect(mechaChat(client, { id: "mx-abc", message: "hello" })).rejects.toThrow(TokenNotFoundError);
  });

  it("throws TokenNotFoundError when env is empty", async () => {
    mockGetContainerPortAndEnv.mockResolvedValueOnce({ port: 7700, env: [] });
    await expect(mechaChat(client, { id: "mx-abc", message: "hello" })).rejects.toThrow(TokenNotFoundError);
  });

  it("throws when no port binding", async () => {
    mockGetContainerPortAndEnv.mockResolvedValueOnce({ port: undefined, env: [] });
    await expect(mechaChat(client, { id: "mx-abc", message: "hi" })).rejects.toThrow(NoPortBindingError);
  });

  it("aborts on timeout", async () => {
    mockGetContainerPortAndEnv.mockResolvedValueOnce({
      port: 7700,
      env: ["MECHA_AUTH_TOKEN=tok"],
    });
    const abortError = new DOMException("The operation was aborted", "AbortError");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(abortError));
    await expect(mechaChat(client, { id: "mx-abc", message: "hi" })).rejects.toThrow("aborted");
    vi.unstubAllGlobals();
  });

  it("throws on non-ok response", async () => {
    mockGetContainerPortAndEnv.mockResolvedValueOnce({
      port: 7700,
      env: ["MECHA_AUTH_TOKEN=tok"],
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({ ok: false, status: 500, statusText: "Internal" }));
    await expect(mechaChat(client, { id: "mx-abc", message: "hi" })).rejects.toThrow(ChatRequestFailedError);
    vi.unstubAllGlobals();
  });
});

// --- Helper: set up runtime access mocks (token + port) ---
function setupRuntimeAccess(): void {
  mockGetContainerPortAndEnv.mockResolvedValue({
    port: 7700,
    env: ["MECHA_AUTH_TOKEN=test-token"],
  });
}

// --- getRuntimeAccess error paths (tested via session functions) ---
describe("getRuntimeAccess error paths", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("throws NoPortBindingError when no port", async () => {
    mockGetContainerPortAndEnv.mockResolvedValueOnce({ port: undefined, env: [] });
    await expect(mechaSessionCreate(client, { id: "mx-abc" })).rejects.toThrow(NoPortBindingError);
  });

  it("throws TokenNotFoundError when no token env", async () => {
    mockGetContainerPortAndEnv.mockResolvedValueOnce({ port: 7700, env: [] });
    await expect(mechaSessionCreate(client, { id: "mx-abc" })).rejects.toThrow(TokenNotFoundError);
  });

  it("throws TokenNotFoundError when env has no token entry", async () => {
    mockGetContainerPortAndEnv.mockResolvedValueOnce({ port: 7700, env: ["OTHER=val"] });
    await expect(mechaSessionCreate(client, { id: "mx-abc" })).rejects.toThrow(TokenNotFoundError);
  });
});

// --- mapSessionError fallback ---
describe("mapSessionError fallback", () => {
  beforeEach(() => setupRuntimeAccess());
  afterEach(() => vi.unstubAllGlobals());

  it("throws generic Error for unmapped status codes", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve("Server Error"),
    }));
    await expect(mechaSessionCreate(client, { id: "mx-abc" })).rejects.toThrow("Session request failed: 500 Server Error");
  });
});

// --- mechaSessionCreate ---
describe("mechaSessionCreate", () => {
  beforeEach(() => setupRuntimeAccess());
  afterEach(() => vi.unstubAllGlobals());

  it("sends POST to /api/sessions with auth and body, returns parsed JSON", async () => {
    const responseBody = { sessionId: "sess-new-123" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(responseBody),
    }));
    const result = await mechaSessionCreate(client, { id: "mx-abc", title: "My Session" });
    expect(result).toEqual(responseBody);
    const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(fetchCall[0]).toBe("http://127.0.0.1:7700/api/sessions");
    expect(fetchCall[1].method).toBe("POST");
    expect(fetchCall[1].headers.get("Authorization")).toBe("Bearer test-token");
    expect(JSON.parse(fetchCall[1].body)).toHaveProperty("title", "My Session");
  });

  it("throws SessionCapReachedError on 429", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: () => Promise.resolve("Too many sessions"),
    }));
    await expect(mechaSessionCreate(client, { id: "mx-abc" })).rejects.toThrow(SessionCapReachedError);
  });

  it("throws SessionNotFoundError with 'unknown' when no sessionId on 404", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: () => Promise.resolve("Not found"),
    }));
    try {
      await mechaSessionCreate(client, { id: "mx-abc" });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(SessionNotFoundError);
      expect((err as Error).message).toContain("unknown");
    }
  });

  it("throws SessionBusyError with 'unknown' when no sessionId on 409", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 409,
      text: () => Promise.resolve("Busy"),
    }));
    try {
      await mechaSessionCreate(client, { id: "mx-abc" });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(SessionBusyError);
      expect((err as Error).message).toContain("unknown");
    }
  });
});

// --- getMechaPath ---
describe("getMechaPath", () => {
  it("returns path from container labels", async () => {
    mockInspectContainer.mockResolvedValue({
      Config: { Labels: { "mecha.path": "/home/user/project" } },
    });
    const path = await getMechaPath(client, "mx-abc");
    expect(path).toBe("/home/user/project");
  });

  it("throws when label is missing", async () => {
    mockInspectContainer.mockResolvedValue({ Config: { Labels: {} } });
    await expect(getMechaPath(client, "mx-abc")).rejects.toThrow("has no mecha.path label");
  });

  it("throws when Config is undefined", async () => {
    mockInspectContainer.mockResolvedValue({});
    await expect(getMechaPath(client, "mx-abc")).rejects.toThrow("has no mecha.path label");
  });
});

// --- mechaSessionList (filesystem-based) ---
describe("mechaSessionList", () => {
  beforeEach(() => {
    mockInspectContainer.mockResolvedValue({
      Config: { Labels: { "mecha.path": "/home/user/project" } },
    });
  });

  it("returns sessions from filesystem and metadata", async () => {
    const summary = {
      id: "s1", projectSlug: "-home", title: "test", messageCount: 1,
      model: "claude", createdAt: new Date(), updatedAt: new Date(),
    };
    mockListSessionFiles.mockReturnValue([{ sessionId: "s1", filePath: "/path/s1.jsonl", projectSlug: "-home" }]);
    mockParseSessionSummary.mockReturnValue(summary);
    mockGetAllSessionMeta.mockReturnValue({ s1: { starred: true } });

    const result = await mechaSessionList(client, { id: "mx-abc" });

    expect(result.sessions).toEqual([summary]);
    expect(result.meta).toEqual({ s1: { starred: true } });
  });

  it("returns empty when no session files exist", async () => {
    mockListSessionFiles.mockReturnValue([]);
    mockGetAllSessionMeta.mockReturnValue({});
    const result = await mechaSessionList(client, { id: "mx-abc" });
    expect(result.sessions).toEqual([]);
    expect(result.meta).toEqual({});
  });
});

// --- mechaSessionGet (filesystem-based) ---
describe("mechaSessionGet", () => {
  beforeEach(() => {
    mockInspectContainer.mockResolvedValue({
      Config: { Labels: { "mecha.path": "/home/user/project" } },
    });
  });

  it("returns parsed session for matching ID", async () => {
    const parsed = {
      id: "sess-abc", projectSlug: "-home", title: "Test", messageCount: 0,
      model: "claude", createdAt: new Date(), updatedAt: new Date(), messages: [],
    };
    mockListSessionFiles.mockReturnValue([{ sessionId: "sess-abc", filePath: "/path/sess-abc.jsonl", projectSlug: "-home" }]);
    mockParseSessionFile.mockReturnValue(parsed);

    const result = await mechaSessionGet(client, { id: "mx-abc", sessionId: "sess-abc" });
    expect(result).toEqual(parsed);
  });

  it("throws SessionNotFoundError when session file not found", async () => {
    mockListSessionFiles.mockReturnValue([]);
    await expect(mechaSessionGet(client, { id: "mx-abc", sessionId: "bad-sess" })).rejects.toThrow(SessionNotFoundError);
  });
});

// --- mechaSessionDelete (filesystem + best-effort runtime) ---
describe("mechaSessionDelete", () => {
  beforeEach(() => {
    setupRuntimeAccess();
    mockInspectContainer.mockResolvedValue({
      Config: { Labels: { "mecha.path": "/home/user/project" } },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("deletes JSONL file and attempts runtime cleanup", async () => {
    mockListSessionFiles.mockReturnValue([{ sessionId: "sess-del", filePath: "/path/sess-del.jsonl", projectSlug: "-home" }]);
    // Mock runtime fetch (best-effort cleanup)
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({ ok: true, status: 204 }));

    await expect(mechaSessionDelete(client, { id: "mx-abc", sessionId: "sess-del" })).resolves.toBeUndefined();
    expect(mockUnlinkSync).toHaveBeenCalledWith("/path/sess-del.jsonl");
    expect(mockDeleteSessionMeta).toHaveBeenCalledWith("mx-abc", "sess-del");
  });

  it("throws SessionNotFoundError when session file not found", async () => {
    mockListSessionFiles.mockReturnValue([]);
    await expect(mechaSessionDelete(client, { id: "mx-abc", sessionId: "bad-sess" })).rejects.toThrow(SessionNotFoundError);
  });

  it("rejects symlinked session files", async () => {
    mockListSessionFiles.mockReturnValue([{ sessionId: "sess-sym", filePath: "/path/sess-sym.jsonl", projectSlug: "-home" }]);
    mockLstatSync.mockReturnValueOnce({ isSymbolicLink: () => true });
    await expect(mechaSessionDelete(client, { id: "mx-abc", sessionId: "sess-sym" })).rejects.toThrow("Refusing to delete symlinked session file");
    expect(mockUnlinkSync).not.toHaveBeenCalled();
  });

  it("ignores ECONNREFUSED from runtime cleanup", async () => {
    mockListSessionFiles.mockReturnValue([{ sessionId: "sess-del2", filePath: "/path/sess-del2.jsonl", projectSlug: "-home" }]);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new Error("fetch failed")));
    await expect(mechaSessionDelete(client, { id: "mx-abc", sessionId: "sess-del2" })).resolves.toBeUndefined();
    expect(mockUnlinkSync).toHaveBeenCalledWith("/path/sess-del2.jsonl");
    expect(mockDeleteSessionMeta).toHaveBeenCalledWith("mx-abc", "sess-del2");
  });

  it("rethrows non-connection errors from runtime cleanup", async () => {
    mockListSessionFiles.mockReturnValue([{ sessionId: "sess-del3", filePath: "/path/sess-del3.jsonl", projectSlug: "-home" }]);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new Error("Internal server error")));
    await expect(mechaSessionDelete(client, { id: "mx-abc", sessionId: "sess-del3" })).rejects.toThrow("Internal server error");
  });

  it("rethrows non-Error thrown values from runtime cleanup", async () => {
    mockListSessionFiles.mockReturnValue([{ sessionId: "sess-del4", filePath: "/path/sess-del4.jsonl", projectSlug: "-home" }]);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce("string error"));
    await expect(mechaSessionDelete(client, { id: "mx-abc", sessionId: "sess-del4" })).rejects.toBe("string error");
  });
});

// --- mechaSessionMessage ---
describe("mechaSessionMessage", () => {
  beforeEach(() => setupRuntimeAccess());
  afterEach(() => vi.unstubAllGlobals());

  it("returns Response with body stream", async () => {
    const mockBody = new ReadableStream();
    const mockResponse = { ok: true, body: mockBody } as unknown as Response;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(mockResponse));
    const res = await mechaSessionMessage(client, { id: "mx-abc", sessionId: "sess-1", message: "hello" });
    expect(res).toBe(mockResponse);
    expect(res.body).toBe(mockBody);
    const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(fetchCall[0]).toBe("http://127.0.0.1:7700/api/sessions/sess-1/message");
    expect(fetchCall[1].method).toBe("POST");
    expect(JSON.parse(fetchCall[1].body)).toEqual({ message: "hello" });
  });

  it("throws SessionBusyError on 409", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 409,
      text: () => Promise.resolve("Busy"),
    }));
    await expect(mechaSessionMessage(client, { id: "mx-abc", sessionId: "sess-1", message: "hi" })).rejects.toThrow(SessionBusyError);
  });
});

// --- mechaSessionInterrupt ---
describe("mechaSessionInterrupt", () => {
  beforeEach(() => setupRuntimeAccess());
  afterEach(() => vi.unstubAllGlobals());

  it("throws SessionNotFoundError on 404", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: () => Promise.resolve("Not found"),
    }));
    await expect(mechaSessionInterrupt(client, { id: "mx-abc", sessionId: "bad-sess" })).rejects.toThrow(SessionNotFoundError);
  });

  it("sends POST and returns { interrupted: true }", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ interrupted: true }),
    }));
    const result = await mechaSessionInterrupt(client, { id: "mx-abc", sessionId: "sess-int" });
    expect(result).toEqual({ interrupted: true });
    const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(fetchCall[0]).toBe("http://127.0.0.1:7700/api/sessions/sess-int/interrupt");
    expect(fetchCall[1].method).toBe("POST");
  });
});

// --- mechaSessionRename (metadata-based) ---
describe("mechaSessionRename", () => {
  beforeEach(() => {
    mockInspectContainer.mockResolvedValue({
      Config: { Labels: { "mecha.path": "/home/user/project" } },
    });
    mockListSessionFiles.mockReturnValue([{ sessionId: "sess-1", filePath: "/path/sess-1.jsonl", projectSlug: "-home" }]);
  });

  it("sets metadata and returns title", async () => {
    const result = await mechaSessionRename(client, { id: "mx-abc", sessionId: "sess-1", title: "New Title" });
    expect(result).toEqual({ title: "New Title" });
    expect(mockSetSessionMeta).toHaveBeenCalledWith("mx-abc", "sess-1", { customTitle: "New Title" });
  });

  it("throws SessionNotFoundError when session file not found", async () => {
    mockListSessionFiles.mockReturnValue([]);
    await expect(mechaSessionRename(client, { id: "mx-abc", sessionId: "bad-sess", title: "Title" })).rejects.toThrow(SessionNotFoundError);
  });
});

// --- mechaSessionConfigUpdate ---
describe("mechaSessionConfigUpdate", () => {
  beforeEach(() => setupRuntimeAccess());
  afterEach(() => vi.unstubAllGlobals());

  it("throws SessionBusyError on 409", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 409,
      text: () => Promise.resolve("Busy"),
    }));
    await expect(mechaSessionConfigUpdate(client, { id: "mx-abc", sessionId: "busy-sess", config: { maxTurns: 10 } })).rejects.toThrow(SessionBusyError);
  });

  it("sends PUT with config body", async () => {
    const config = { model: "claude-3", maxTokens: 1000 };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    }));
    const result = await mechaSessionConfigUpdate(client, { id: "mx-abc", sessionId: "sess-cfg", config });
    expect(result).toEqual({ ok: true });
    const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(fetchCall[0]).toBe("http://127.0.0.1:7700/api/sessions/sess-cfg/config");
    expect(fetchCall[1].method).toBe("PUT");
    expect(fetchCall[1].headers.get("Content-Type")).toBe("application/json");
    expect(JSON.parse(fetchCall[1].body)).toEqual(config);
  });

  it("mapSessionError maps 400 to Error with body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: () => Promise.resolve("Invalid config"),
    }));
    await expect(mechaSessionCreate(client, { id: "mx-abc" })).rejects.toThrow("Bad request: Invalid config");
  });

  it("mapSessionError maps 503 to Error with body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: () => Promise.resolve("Sessions not available"),
    }));
    await expect(mechaSessionCreate(client, { id: "mx-abc" })).rejects.toThrow("Service unavailable: Sessions not available");
  });
});
