import type { FastifyInstance, FastifyReply } from "fastify";
import type { DockerClient } from "@mecha/docker";
import {
  mechaSessionList,
  mechaSessionCreate,
  mechaSessionMessage,
  mechaSessionGet,
  mechaSessionDelete,
} from "@mecha/service";
import { SessionCreateInput, SessionMetaUpdate, toHttpStatus, toSafeMessage } from "@mecha/contracts";
import { setSessionMeta } from "@mecha/core";

function errorResponse(reply: FastifyReply, err: unknown) {
  reply.code(toHttpStatus(err));
  return { error: toSafeMessage(err) };
}

export function registerSessionRoutes(app: FastifyInstance, docker: DockerClient): void {
  app.get<{ Params: { id: string } }>("/mechas/:id/sessions", async (req, reply) => {
    try {
      return await mechaSessionList(docker, { id: req.params.id });
    } catch (err) {
      return errorResponse(reply, err);
    }
  });

  app.post<{ Params: { id: string }; Body: { title?: string; config?: unknown } }>(
    "/mechas/:id/sessions",
    async (req, reply) => {
      try {
        const input = SessionCreateInput.parse({
          id: req.params.id,
          title: req.body?.title,
          config: req.body?.config,
        });
        const result = await mechaSessionCreate(docker, input);
        reply.code(201);
        return result;
      } catch (err) {
        return errorResponse(reply, err);
      }
    },
  );

  // --- Phase 1.3: GET single session ---
  app.get<{ Params: { id: string; sessionId: string } }>(
    "/mechas/:id/sessions/:sessionId",
    async (req, reply) => {
      try {
        return await mechaSessionGet(docker, {
          id: req.params.id,
          sessionId: req.params.sessionId,
        });
      } catch (err) {
        return errorResponse(reply, err);
      }
    },
  );

  // --- Phase 1.2: DELETE session ---
  app.delete<{ Params: { id: string; sessionId: string } }>(
    "/mechas/:id/sessions/:sessionId",
    async (req, reply) => {
      try {
        await mechaSessionDelete(docker, {
          id: req.params.id,
          sessionId: req.params.sessionId,
        });
        reply.code(204);
        return;
      } catch (err) {
        return errorResponse(reply, err);
      }
    },
  );

  // --- Phase 1.1: PATCH session metadata ---
  app.patch<{ Params: { id: string; sessionId: string }; Body: unknown }>(
    "/mechas/:id/sessions/:sessionId/meta",
    async (req, reply) => {
      try {
        const meta = SessionMetaUpdate.parse(req.body);
        // Convert null → undefined for clearing fields
        const patch: { customTitle?: string; starred?: boolean } = {};
        if (meta.customTitle !== undefined) patch.customTitle = meta.customTitle ?? undefined;
        if (meta.starred !== undefined) patch.starred = meta.starred ?? undefined;
        setSessionMeta(req.params.id, req.params.sessionId, patch);
        return { ok: true };
      } catch (err) {
        return errorResponse(reply, err);
      }
    },
  );

  app.post<{ Params: { id: string; sessionId: string }; Body: { message: string } }>(
    "/mechas/:id/sessions/:sessionId/message",
    async (req, reply) => {
      try {
        const upstream = await mechaSessionMessage(
          docker,
          { id: req.params.id, sessionId: req.params.sessionId, message: req.body.message },
          undefined,
        );

        reply.raw.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });

        const reader = upstream.body?.getReader();
        if (!reader) {
          reply.raw.end();
          return reply;
        }

        /* v8 ignore start -- socket close not testable via inject */
        const onClose = () => { reader.cancel().catch(() => {}); };
        /* v8 ignore stop */
        req.socket.on("close", onClose);

        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            reply.raw.write(value);
          }
        } finally {
          req.socket.removeListener("close", onClose);
          reply.raw.end();
        }

        return reply;
      } catch (err) {
        return errorResponse(reply, err);
      }
    },
  );
}
