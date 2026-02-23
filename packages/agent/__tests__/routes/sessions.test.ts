import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerSessionRoutes } from "../../src/routes/sessions.js";
import type { DockerClient } from "@mecha/docker";

const mockMechaSessionList = vi.fn();
const mockMechaSessionCreate = vi.fn();
const mockMechaSessionMessage = vi.fn();
const mockMechaSessionGet = vi.fn();
const mockMechaSessionDelete = vi.fn();

vi.mock("@mecha/service", () => ({
  mechaSessionList: (...args: unknown[]) => mockMechaSessionList(...args),
  mechaSessionCreate: (...args: unknown[]) => mockMechaSessionCreate(...args),
  mechaSessionMessage: (...args: unknown[]) => mockMechaSessionMessage(...args),
  mechaSessionGet: (...args: unknown[]) => mockMechaSessionGet(...args),
  mechaSessionDelete: (...args: unknown[]) => mockMechaSessionDelete(...args),
}));

const mockSetSessionMeta = vi.fn();

vi.mock("@mecha/core", () => ({
  setSessionMeta: (...args: unknown[]) => mockSetSessionMeta(...args),
}));

vi.mock("@mecha/contracts", () => ({
  SessionCreateInput: { parse: (v: unknown) => v },
  SessionMetaUpdate: {
    parse: (v: unknown) => {
      const o = v as Record<string, unknown>;
      if (o.customTitle === undefined && o.starred === undefined) {
        throw new Error("At least one field required");
      }
      if (typeof o.customTitle === "string" && o.customTitle.length === 0) {
        throw new Error("customTitle min 1");
      }
      return v;
    },
  },
  toHttpStatus: (err: unknown) => (err instanceof Error && err.message.includes("not found") ? 404 : 500),
  toSafeMessage: (err: unknown) => (err instanceof Error ? err.message : "Unknown error"),
}));

describe("session routes", () => {
  const docker = { docker: {} } as DockerClient;

  function buildApp() {
    const app = Fastify();
    registerSessionRoutes(app, docker);
    return app;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /mechas/:id/sessions", () => {
    it("returns session list", async () => {
      const sessions = [{ sessionId: "s1", title: "Test" }];
      mockMechaSessionList.mockResolvedValue(sessions);
      const res = await buildApp().inject({ method: "GET", url: "/mechas/m1/sessions" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(sessions);
    });

    it("returns error on failure", async () => {
      mockMechaSessionList.mockRejectedValue(new Error("not found"));
      const res = await buildApp().inject({ method: "GET", url: "/mechas/m1/sessions" });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: "not found" });
    });
  });

  describe("POST /mechas/:id/sessions", () => {
    it("creates a session and returns 201", async () => {
      const result = { sessionId: "s2", title: "New" };
      mockMechaSessionCreate.mockResolvedValue(result);
      const res = await buildApp().inject({
        method: "POST",
        url: "/mechas/m1/sessions",
        payload: { title: "New" },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toEqual(result);
    });

    it("returns error on failure", async () => {
      mockMechaSessionCreate.mockRejectedValue(new Error("create failed"));
      const res = await buildApp().inject({
        method: "POST",
        url: "/mechas/m1/sessions",
        payload: { title: "New" },
      });
      expect(res.statusCode).toBe(500);
      expect(res.json()).toEqual({ error: "create failed" });
    });
  });

  describe("POST /mechas/:id/sessions/:sessionId/message", () => {
    it("proxies SSE stream from upstream", async () => {
      const chunks = [new TextEncoder().encode("data: hello\n\n")];
      const mockReader = {
        read: vi.fn()
          .mockResolvedValueOnce({ done: false, value: chunks[0] })
          .mockResolvedValueOnce({ done: true, value: undefined }),
        cancel: vi.fn().mockResolvedValue(undefined),
      };
      const mockBody = { getReader: () => mockReader };
      mockMechaSessionMessage.mockResolvedValue({ body: mockBody });

      const app = buildApp();
      const res = await app.inject({
        method: "POST",
        url: "/mechas/m1/sessions/s1/message",
        payload: { message: "hi" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toBe("text/event-stream");
      expect(res.body).toContain("data: hello");
      expect(mockMechaSessionMessage).toHaveBeenCalledWith(
        docker,
        { id: "m1", sessionId: "s1", message: "hi" },
        undefined,
      );
    });

    it("handles null body from upstream", async () => {
      mockMechaSessionMessage.mockResolvedValue({ body: null });
      const app = buildApp();
      const res = await app.inject({
        method: "POST",
        url: "/mechas/m1/sessions/s1/message",
        payload: { message: "hi" },
      });
      expect(res.statusCode).toBe(200);
    });

    it("returns error when upstream throws", async () => {
      mockMechaSessionMessage.mockRejectedValue(new Error("not found"));
      const app = buildApp();
      const res = await app.inject({
        method: "POST",
        url: "/mechas/m1/sessions/s1/message",
        payload: { message: "hi" },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: "not found" });
    });
  });

  // --- Phase 1.1: PATCH /mechas/:id/sessions/:sessionId/meta ---
  describe("PATCH /mechas/:id/sessions/:sessionId/meta", () => {
    it("sets starred metadata and returns 200", async () => {
      const res = await buildApp().inject({
        method: "PATCH",
        url: "/mechas/m1/sessions/s1/meta",
        payload: { starred: true },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
      expect(mockSetSessionMeta).toHaveBeenCalledWith("m1", "s1", { starred: true });
    });

    it("sets customTitle metadata and returns 200", async () => {
      const res = await buildApp().inject({
        method: "PATCH",
        url: "/mechas/m1/sessions/s1/meta",
        payload: { customTitle: "My Title" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
      expect(mockSetSessionMeta).toHaveBeenCalledWith("m1", "s1", { customTitle: "My Title" });
    });

    it("returns 500 for empty body (validation fails)", async () => {
      const res = await buildApp().inject({
        method: "PATCH",
        url: "/mechas/m1/sessions/s1/meta",
        payload: {},
      });
      expect(res.statusCode).toBe(500);
    });

    it("converts null values to undefined for clearing fields", async () => {
      const res = await buildApp().inject({
        method: "PATCH",
        url: "/mechas/m1/sessions/s1/meta",
        payload: { customTitle: null, starred: null },
      });
      expect(res.statusCode).toBe(200);
      expect(mockSetSessionMeta).toHaveBeenCalledWith("m1", "s1", {
        customTitle: undefined,
        starred: undefined,
      });
    });

    it("returns 500 for empty customTitle (validation fails)", async () => {
      const res = await buildApp().inject({
        method: "PATCH",
        url: "/mechas/m1/sessions/s1/meta",
        payload: { customTitle: "" },
      });
      expect(res.statusCode).toBe(500);
    });
  });

  // --- Phase 1.2: DELETE /mechas/:id/sessions/:sessionId ---
  describe("DELETE /mechas/:id/sessions/:sessionId", () => {
    it("deletes session and returns 204", async () => {
      mockMechaSessionDelete.mockResolvedValue(undefined);
      const res = await buildApp().inject({
        method: "DELETE",
        url: "/mechas/m1/sessions/s1",
      });
      expect(res.statusCode).toBe(204);
      expect(mockMechaSessionDelete).toHaveBeenCalledWith(docker, { id: "m1", sessionId: "s1" });
    });

    it("returns 404 when session not found", async () => {
      mockMechaSessionDelete.mockRejectedValue(new Error("not found"));
      const res = await buildApp().inject({
        method: "DELETE",
        url: "/mechas/m1/sessions/bad",
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: "not found" });
    });
  });

  // --- Phase 1.3: GET /mechas/:id/sessions/:sessionId ---
  describe("GET /mechas/:id/sessions/:sessionId", () => {
    it("returns parsed session", async () => {
      const session = { id: "s1", projectSlug: "-home", messages: [], title: "test" };
      mockMechaSessionGet.mockResolvedValue(session);
      const res = await buildApp().inject({
        method: "GET",
        url: "/mechas/m1/sessions/s1",
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(session);
      expect(mockMechaSessionGet).toHaveBeenCalledWith(docker, { id: "m1", sessionId: "s1" });
    });

    it("returns 404 when session not found", async () => {
      mockMechaSessionGet.mockRejectedValue(new Error("not found"));
      const res = await buildApp().inject({
        method: "GET",
        url: "/mechas/m1/sessions/bad",
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: "not found" });
    });
  });
});
