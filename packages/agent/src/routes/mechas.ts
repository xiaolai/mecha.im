import type { FastifyInstance, FastifyReply } from "fastify";
import type { ProcessManager } from "@mecha/process";
import { mechaLs, mechaUp, mechaRm, mechaStart, mechaStop } from "@mecha/service";
import { MechaUpInput, toHttpStatus, toSafeMessage } from "@mecha/contracts";

function errorResponse(reply: FastifyReply, err: unknown) {
  reply.code(toHttpStatus(err));
  return { error: toSafeMessage(err) };
}

export function registerMechaRoutes(app: FastifyInstance, pm: ProcessManager): void {
  app.get("/mechas", async (_req, reply) => {
    try {
      return await mechaLs(pm);
    } catch (err) {
      return errorResponse(reply, err);
    }
  });

  app.post<{ Body: Record<string, unknown> }>("/mechas", async (req, reply) => {
    try {
      const input = MechaUpInput.parse(req.body);
      const result = await mechaUp(pm, input);
      reply.code(201);
      return result;
    } catch (err) {
      return errorResponse(reply, err);
    }
  });

  app.delete<{ Params: { id: string } }>("/mechas/:id", async (req, reply) => {
    try {
      await mechaRm(pm, { id: req.params.id, withState: false, force: false });
      return { ok: true };
    } catch (err) {
      return errorResponse(reply, err);
    }
  });

  app.post<{ Params: { id: string } }>("/mechas/:id/start", async (req, reply) => {
    try {
      await mechaStart(pm, req.params.id);
      return { ok: true };
    } catch (err) {
      return errorResponse(reply, err);
    }
  });

  app.post<{ Params: { id: string } }>("/mechas/:id/stop", async (req, reply) => {
    try {
      await mechaStop(pm, req.params.id);
      return { ok: true };
    } catch (err) {
      return errorResponse(reply, err);
    }
  });
}
