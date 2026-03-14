import { randomBytes } from "node:crypto";
import { z } from "zod";

export const DASHBOARD_TOKEN = process.env.MECHA_DASHBOARD_TOKEN || ("mecha_dash_" + randomBytes(24).toString("hex"));
export const DASHBOARD_COOKIE = "mecha_dashboard_session";

export const HOP_BY_HOP = new Set([
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailers", "transfer-encoding", "upgrade", "host",
]);

export const spawnBodySchema = z.object({
  config_path: z.string().optional(),
  name: z.string().min(1).max(32).optional(),
  system: z.string().min(1).optional(),
  model: z.string().optional(),
  dir: z.string().optional(),
});

export const authBodySchema = z.object({
  profile: z.string().min(1).max(32),
  key: z.string().min(1),
});

export const totpVerifySchema = z.object({
  code: z.string().length(6).regex(/^\d{6}$/),
});
