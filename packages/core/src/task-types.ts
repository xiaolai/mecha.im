/**
 * Task protocol types and Zod schemas.
 * Canonical contract — all layers use these exactly.
 */
import { z } from "zod";

export const TaskStatusSchema = z.enum(["pending", "working", "completed", "failed", "cancelled"]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TERMINAL_STATUSES: readonly TaskStatus[] = ["completed", "failed", "cancelled"];

export const TaskSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  status: TaskStatusSchema,
  message: z.string().min(1),
  result: z.string().optional(),
  error: z.string().optional(),
  sessionId: z.string().optional(),
  durationMs: z.number().optional(),
  costUsd: z.number().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Task = z.infer<typeof TaskSchema>;

export const TaskCreateInputSchema = z.object({
  target: z.string().min(1),
  message: z.string().min(1),
});
export type TaskCreateInput = z.infer<typeof TaskCreateInputSchema>;
