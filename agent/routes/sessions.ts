import { Hono } from "hono";
import { log } from "../../shared/logger.js";
import type { SessionHistory } from "../session-history.js";

export function createSessionRoutes(sessionHistory: SessionHistory): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    try {
      const list = await sessionHistory.list();
      return c.json(list);
    } catch (err) {
      log.error("Failed to list sessions", { error: err instanceof Error ? err.message : String(err) });
      return c.json({ error: "Failed to list sessions" }, 500);
    }
  });

  app.get("/search", async (c) => {
    try {
      const q = (c.req.query("q") ?? "").slice(0, 500);
      if (!q.trim()) return c.json([]);
      const results = await sessionHistory.search(q);
      return c.json(results);
    } catch (err) {
      log.error("Failed to search sessions", { error: err instanceof Error ? err.message : String(err) });
      return c.json({ error: "Failed to search sessions" }, 500);
    }
  });

  app.get("/:id", async (c) => {
    try {
      const id = c.req.param("id");
      const detail = await sessionHistory.getConversation(id);
      if (!detail) return c.json({ error: "Session not found" }, 404);
      return c.json(detail);
    } catch (err) {
      log.error("Failed to get session", { error: err instanceof Error ? err.message : String(err) });
      return c.json({ error: "Failed to get session" }, 500);
    }
  });

  return app;
}
