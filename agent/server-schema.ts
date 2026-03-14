import { z } from "zod";
import { randomBytes } from "node:crypto";
import { log } from "../shared/logger.js";

export const promptSchema = z.object({
  message: z.string().min(1),
  model: z.string().optional(),
  system: z.string().optional(),
  max_turns: z.number().int().min(1).max(200).optional(),
  resume: z.string().min(1).optional(),
  effort: z.enum(["low", "medium", "high", "max"]).optional(),
  max_budget_usd: z.number().positive().optional(),
});

export type PromptOverrides = Omit<z.infer<typeof promptSchema>, "message">;

export const INTERNAL_AUTH_HEADER = "x-mecha-internal-auth";

export const BOT_TOKEN = process.env.MECHA_BOT_TOKEN || ("mecha_agent_" + randomBytes(24).toString("hex"));
export const FLEET_INTERNAL_SECRET = process.env.MECHA_FLEET_INTERNAL_SECRET;

if (!process.env.MECHA_BOT_TOKEN) {
  log.warn("MECHA_BOT_TOKEN not set — auto-generated token for this session. Set MECHA_BOT_TOKEN for stable auth.");
  log.info(`Auto-generated agent token: ${BOT_TOKEN.slice(0, 14)}...`);
}
