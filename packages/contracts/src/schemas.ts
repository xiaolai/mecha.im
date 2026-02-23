import { z } from "zod";
import { NAME_PATTERN, NAME_MAX_LENGTH } from "@mecha/core";

/** Reusable name schema matching CASA/node naming rules */
const nameSchema = z
  .string()
  .min(1)
  .max(NAME_MAX_LENGTH)
  .regex(NAME_PATTERN, "Must be lowercase alphanumeric with hyphens, no leading/trailing hyphen");

/** Permission modes for CASA processes */
export const PermissionMode = z.enum(["default", "plan", "full-auto"]);
export type PermissionMode = z.infer<typeof PermissionMode>;

/** mecha spawn NAME PATH [options] */
export const CasaSpawnInput = z.object({
  name: nameSchema,
  workspacePath: z.string().min(1),
  tags: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  model: z.string().optional(),
  permissionMode: PermissionMode.optional(),
  port: z.number().int().min(1).max(65535).optional(),
});
export type CasaSpawnInput = z.infer<typeof CasaSpawnInput>;

/** mecha kill NAME [options] */
export const CasaKillInput = z.object({
  name: nameSchema,
  force: z.boolean().optional(),
});
export type CasaKillInput = z.infer<typeof CasaKillInput>;

/** Session creation */
export const SessionCreateInput = z.object({
  title: z.string().optional(),
  model: z.string().optional(),
});
export type SessionCreateInput = z.infer<typeof SessionCreateInput>;

/** Session message */
export const SessionMessageInput = z.object({
  message: z.string().min(1),
  model: z.string().optional(),
});
export type SessionMessageInput = z.infer<typeof SessionMessageInput>;
