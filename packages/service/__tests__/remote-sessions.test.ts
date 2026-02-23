import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  remoteSessionList,
  remoteSessionGet,
  remoteSessionMetaUpdate,
  remoteSessionDelete,
} from "../src/remote-sessions.js";
import type { DockerClient } from "@mecha/docker";
import type { NodeEntry } from "../src/agent-client.js";

const mockMechaSessionList = vi.fn();
const mockMechaSessionGet = vi.fn();
const mockMechaSessionDelete = vi.fn();

vi.mock("../src/sessions.js", () => ({
  mechaSessionList: (...args: unknown[]) => mockMechaSessionList(...args),
  mechaSessionGet: (...args: unknown[]) => mockMechaSessionGet(...args),
  mechaSessionDelete: (...args: unknown[]) => mockMechaSessionDelete(...args),
}));

const mockAgentFetch = vi.fn();
vi.mock("../src/agent-client.js", () => ({
  agentFetch: (...args: unknown[]) => mockAgentFetch(...args),
}));

const mockSetSessionMeta = vi.fn();
vi.mock("@mecha/core", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    setSessionMeta: (...args: unknown[]) => mockSetSessionMeta(...args),
  };
});

const client = {} as DockerClient;
const remoteEntry: NodeEntry = { name: "gpu", host: "http://100.64.0.2:7660", key: "k1" };

describe("remoteSessionList", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls mechaSessionList for local target", async () => {
    const result = { sessions: [], meta: {} };
    mockMechaSessionList.mockResolvedValue(result);
    const res = await remoteSessionList(client, "mx-foo", { node: "local" });
    expect(res).toEqual(result);
    expect(mockAgentFetch).not.toHaveBeenCalled();
  });

  it("calls agentFetch for remote target", async () => {
    const result = { sessions: [{ id: "s1" }], meta: {} };
    mockAgentFetch.mockResolvedValue({ json: async () => result });
    const res = await remoteSessionList(client, "mx-foo", { node: "gpu", entry: remoteEntry });
    expect(res).toEqual(result);
    expect(mockAgentFetch).toHaveBeenCalledWith(remoteEntry, "/mechas/mx-foo/sessions");
  });
});

describe("remoteSessionGet", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls mechaSessionGet for local target", async () => {
    const session = { id: "s1", messages: [] };
    mockMechaSessionGet.mockResolvedValue(session);
    const res = await remoteSessionGet(client, "mx-foo", "s1", { node: "local" });
    expect(res).toEqual(session);
    expect(mockMechaSessionGet).toHaveBeenCalledWith(client, { id: "mx-foo", sessionId: "s1" });
  });

  it("calls agentFetch for remote target with URL-encoded session ID", async () => {
    const session = { id: "s/1", messages: [] };
    mockAgentFetch.mockResolvedValue({ json: async () => session });
    const res = await remoteSessionGet(client, "mx-foo", "s/1", { node: "gpu", entry: remoteEntry });
    expect(res).toEqual(session);
    expect(mockAgentFetch).toHaveBeenCalledWith(remoteEntry, `/mechas/mx-foo/sessions/${encodeURIComponent("s/1")}`);
  });
});

describe("remoteSessionMetaUpdate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls setSessionMeta for local target", async () => {
    await remoteSessionMetaUpdate("mx-foo", "s1", { starred: true }, { node: "local" });
    expect(mockSetSessionMeta).toHaveBeenCalledWith("mx-foo", "s1", { starred: true });
    expect(mockAgentFetch).not.toHaveBeenCalled();
  });

  it("PATCHes agent for remote target", async () => {
    mockAgentFetch.mockResolvedValue({ ok: true });
    await remoteSessionMetaUpdate("mx-foo", "s1", { customTitle: "Hi" }, { node: "gpu", entry: remoteEntry });
    expect(mockAgentFetch).toHaveBeenCalledWith(
      remoteEntry,
      "/mechas/mx-foo/sessions/s1/meta",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customTitle: "Hi" }),
      },
    );
  });
});

describe("remoteSessionDelete", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls mechaSessionDelete for local target", async () => {
    mockMechaSessionDelete.mockResolvedValue(undefined);
    await remoteSessionDelete(client, "mx-foo", "s1", { node: "local" });
    expect(mockMechaSessionDelete).toHaveBeenCalledWith(client, { id: "mx-foo", sessionId: "s1" });
    expect(mockAgentFetch).not.toHaveBeenCalled();
  });

  it("DELETEs via agent for remote target", async () => {
    mockAgentFetch.mockResolvedValue({ ok: true });
    await remoteSessionDelete(client, "mx-foo", "s1", { node: "gpu", entry: remoteEntry });
    expect(mockAgentFetch).toHaveBeenCalledWith(
      remoteEntry,
      "/mechas/mx-foo/sessions/s1",
      { method: "DELETE" },
    );
  });

  it("URL-encodes session IDs with special chars", async () => {
    mockAgentFetch.mockResolvedValue({ ok: true });
    await remoteSessionDelete(client, "mx-foo", "s/special", { node: "gpu", entry: remoteEntry });
    expect(mockAgentFetch).toHaveBeenCalledWith(
      remoteEntry,
      `/mechas/mx-foo/sessions/${encodeURIComponent("s/special")}`,
      { method: "DELETE" },
    );
  });
});
