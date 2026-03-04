import type { FastifyInstance } from "fastify";
import type { ProcessManager } from "@mecha/process";
import { botScheduleList } from "@mecha/service";

export interface ScheduleOverviewEntry {
  botName: string;
  node: string;
  scheduleId: string;
  every: string;
  prompt: string;
  paused: boolean;
}

/** Max concurrent bot schedule fetches to prevent burst load. */
const CONCURRENCY_LIMIT = 10;

async function fetchWithLimit<T>(
  tasks: Array<() => Promise<T>>,
  limit: number,
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let idx = 0;

  async function next(): Promise<void> {
    while (idx < tasks.length) {
      const i = idx++;
      try {
        results[i] = { status: "fulfilled", value: await tasks[i]!() };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, () => next()));
  return results;
}

export function registerScheduleOverviewRoutes(
  app: FastifyInstance,
  pm: ProcessManager,
  nodeName: string,
): void {
  // Mounted under /bots prefix so it inherits auth from API_PREFIXES
  app.get("/bots/schedules/overview", async (_request, reply) => {
    const bots = pm.list().filter((b) => b.state === "running");

    const tasks = bots.map((bot) => async () => {
      const schedules = await botScheduleList(pm, bot.name);
      return (schedules as Array<{ id: string; trigger: { every: string }; prompt: string; paused?: boolean }>).map(
        (s): ScheduleOverviewEntry => ({
          botName: bot.name,
          node: nodeName,
          scheduleId: s.id,
          every: s.trigger.every,
          prompt: s.prompt,
          paused: s.paused ?? false,
        }),
      );
    });

    const results = await fetchWithLimit(tasks, CONCURRENCY_LIMIT);

    const entries: ScheduleOverviewEntry[] = [];
    let failCount = 0;
    for (const r of results) {
      if (r.status === "fulfilled") {
        entries.push(...r.value);
      } else {
        failCount++;
        app.log.warn("schedule-overview: bot fetch failed: %s", r.reason);
      }
    }

    if (failCount > 0) {
      reply.header("X-Partial-Failures", String(failCount));
    }
    return entries;
  });
}
