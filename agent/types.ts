import { z } from "zod";

const VALID_CRON = /^(\S+\s+){4}\S+$/;

export const botConfigSchema = z.object({
  name: z.string().min(1).max(32),
  system: z.string().min(1),
  model: z.string().default("sonnet"),
  auth: z.string().optional(),
  max_turns: z.number().int().min(1).max(100).default(25),
  max_budget_usd: z.number().positive().optional(),
  permission_mode: z.enum(["default", "acceptEdits", "bypassPermissions", "plan", "dontAsk"]).default("default"),
  schedule: z.array(z.object({
    cron: z.string().refine((s) => VALID_CRON.test(s), { message: "Invalid cron expression (expected 5 fields)" }),
    prompt: z.string().min(1).max(10_000),
  })).optional(),
  webhooks: z.object({
    accept: z.array(z.string()),
    secret: z.string().optional(),
  }).optional(),
  workspace: z.string().optional(),
  workspace_writable: z.boolean().default(false),
  expose: z.number().int().min(1).max(65535).optional(),
  tailscale: z.object({
    auth_key_profile: z.string().optional(),
    auth_key: z.string().optional(),
    login_server: z.string().optional(),
    tags: z.array(z.string()).default(["tag:mecha-bot"]),
  }).optional(),
});

export type BotConfig = z.infer<typeof botConfigSchema>;
