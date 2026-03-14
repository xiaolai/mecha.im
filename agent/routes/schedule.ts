import { Hono } from "hono";
import type { Scheduler } from "../scheduler.js";

export function createScheduleRoutes(getScheduler: () => Scheduler | undefined): Hono {
  const app = new Hono();

  app.get("/", (c) => {
    const scheduler = getScheduler();
    if (!scheduler) return c.json([]);
    return c.json(scheduler.getStatus());
  });

  app.post("/", async (c) => {
    const scheduler = getScheduler();
    if (!scheduler) return c.json({ error: "Scheduler not initialized" }, 400);
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body.cron !== "string" || typeof body.prompt !== "string") {
      return c.json({ error: "cron and prompt are required" }, 400);
    }
    const { cron, prompt } = body as { cron: string; prompt: string };
    if (!prompt.trim()) return c.json({ error: "prompt cannot be empty" }, 400);
    const result = scheduler.addEntry(cron, prompt.trim());
    if (result.error) return c.json({ error: result.error }, 400);
    return c.json({ id: result.id, status: "created" }, 201);
  });

  app.put("/:id", async (c) => {
    const scheduler = getScheduler();
    if (!scheduler) return c.json({ error: "Scheduler not initialized" }, 400);
    const id = c.req.param("id");
    if (!/^[a-f0-9]{16}$/.test(id)) return c.json({ error: "Invalid schedule ID" }, 400);
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: "Request body required" }, 400);
    const updates: { cron?: string; prompt?: string } = {};
    if (typeof body.cron === "string") updates.cron = body.cron;
    if (typeof body.prompt === "string") updates.prompt = body.prompt.trim();
    if (!updates.cron && !updates.prompt) return c.json({ error: "cron or prompt required" }, 400);
    const result = scheduler.updateEntry(id, updates);
    if (result.error) return c.json({ error: result.error }, 400);
    return c.json({ status: "updated" });
  });

  app.delete("/:id", (c) => {
    const scheduler = getScheduler();
    if (!scheduler) return c.json({ error: "Scheduler not initialized" }, 400);
    const id = c.req.param("id");
    if (!/^[a-f0-9]{16}$/.test(id)) return c.json({ error: "Invalid schedule ID" }, 400);
    const ok = scheduler.removeEntry(id);
    if (!ok) return c.json({ error: "Schedule not found" }, 404);
    return c.json({ status: "deleted" });
  });

  app.post("/:id/pause", (c) => {
    const scheduler = getScheduler();
    if (!scheduler) return c.json({ error: "Scheduler not initialized" }, 400);
    const id = c.req.param("id");
    if (!/^[a-f0-9]{16}$/.test(id)) return c.json({ error: "Invalid schedule ID" }, 400);
    const ok = scheduler.pauseEntry(id);
    if (!ok) return c.json({ error: "Entry not found or already paused" }, 400);
    return c.json({ status: "paused" });
  });

  app.post("/:id/resume", (c) => {
    const scheduler = getScheduler();
    if (!scheduler) return c.json({ error: "Scheduler not initialized" }, 400);
    const id = c.req.param("id");
    if (!/^[a-f0-9]{16}$/.test(id)) return c.json({ error: "Invalid schedule ID" }, 400);
    const result = scheduler.resumeEntry(id);
    if (result.error) return c.json({ error: result.error }, 400);
    return c.json({ status: "resumed" });
  });

  app.post("/trigger/:id", async (c) => {
    const scheduler = getScheduler();
    if (!scheduler) return c.json({ error: "No scheduler" }, 404);
    const id = c.req.param("id");
    if (!/^[a-f0-9]{16}$/.test(id)) return c.json({ error: "Invalid schedule ID" }, 400);
    const ok = await scheduler.triggerNow(id);
    if (!ok) return c.json({ error: "Schedule not found" }, 404);
    return c.json({ status: "triggered" });
  });

  return app;
}
