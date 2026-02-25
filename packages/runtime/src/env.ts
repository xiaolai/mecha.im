import { z } from "zod";

export const RuntimeEnv = z.object({
  MECHA_CASA_NAME: z.string().min(1, "MECHA_CASA_NAME is required"),
  MECHA_PORT: z.string().regex(/^\d+$/, "MECHA_PORT must be numeric").transform(Number).pipe(z.number().int().min(1).max(65535)),
  MECHA_AUTH_TOKEN: z.string().min(1, "MECHA_AUTH_TOKEN is required"),
  MECHA_PROJECTS_DIR: z.string().min(1, "MECHA_PROJECTS_DIR is required"),
  MECHA_WORKSPACE: z.string().min(1, "MECHA_WORKSPACE is required"),
  MECHA_DIR: z.string().optional(),
  MECHA_SANDBOX_ROOT: z.string().optional(),
});

export type RuntimeEnvData = z.infer<typeof RuntimeEnv>;

/**
 * Parse and validate runtime environment variables.
 * Returns the validated data or throws with a descriptive error.
 */
export function parseRuntimeEnv(env: Record<string, string | undefined>): RuntimeEnvData {
  const parsed = RuntimeEnv.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid runtime environment:\n${issues}`);
  }
  return parsed.data;
}
