import { z } from "zod";

// --- Shared constants (single source of truth) ---

export const PERMISSION_MODES = ["default", "plan", "full-auto"] as const;
export const PermissionMode = z.enum(PERMISSION_MODES);
export type PermissionMode = z.infer<typeof PermissionMode>;

/** Env var keys that must not be set by users (managed internally) */
export const BLOCKED_ENV_KEYS = new Set([
  "PATH", "HOME", "USER", "SHELL", "LD_PRELOAD", "LD_LIBRARY_PATH",
  "CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY", "MECHA_OTP",
  "MECHA_PERMISSION_MODE", "MECHA_AUTH_TOKEN", "MECHA_ID", "MECHA_DB_PATH",
]);

/** Pattern for allowed env var keys */
const ALLOWED_ENV_KEY = /^[A-Z][A-Z0-9_]*$/;

/** Validates a single env entry "KEY=VALUE" */
const EnvEntry = z.string().refine((entry) => {
  const eqIdx = entry.indexOf("=");
  if (eqIdx <= 0) return false;
  const key = entry.slice(0, eqIdx);
  return ALLOWED_ENV_KEY.test(key) && !BLOCKED_ENV_KEYS.has(key);
}, { message: "Invalid env entry: must be KEY=VALUE with allowed uppercase key" });

// --- Service operation schemas ---

export const MechaUpInput = z.object({
  projectPath:    z.string().min(1),
  port:           z.number().int().min(1024).max(65535).optional(),
  claudeToken:    z.string().optional(),
  anthropicApiKey: z.string().optional(),
  otp:            z.string().optional(),
  permissionMode: PermissionMode.optional(),
  env:            z.array(EnvEntry).optional(),
});
export type MechaUpInput = z.infer<typeof MechaUpInput>;

export const MechaUpResult = z.object({
  id:        z.string(),
  name:      z.string(),
  port:      z.number(),
  authToken: z.string(),
});
export type MechaUpResult = z.infer<typeof MechaUpResult>;

export const MechaRmInput = z.object({
  id:        z.string().min(1),
  withState: z.boolean().default(false),
  force:     z.boolean().default(false),
});
export type MechaRmInput = z.infer<typeof MechaRmInput>;

export const MechaConfigureInput = z.object({
  id:              z.string().min(1),
  claudeToken:     z.string().optional(),
  anthropicApiKey: z.string().optional(),
  otp:             z.string().optional(),
  permissionMode:  PermissionMode.optional(),
});
export type MechaConfigureInput = z.infer<typeof MechaConfigureInput>;

export const MechaLogsInput = z.object({
  id:     z.string().min(1),
  follow: z.boolean().default(false),
  tail:   z.number().int().min(0).default(100),
  since:  z.number().optional(),
});
export type MechaLogsInput = z.infer<typeof MechaLogsInput>;

export const MechaLsItem = z.object({
  id:      z.string(),
  name:    z.string(),
  state:   z.string(),
  status:  z.string(),
  path:    z.string(),
  port:    z.number().optional(),
  created: z.number(),
});
export type MechaLsItem = z.infer<typeof MechaLsItem>;

export const MechaStatusResult = z.object({
  id:         z.string(),
  name:       z.string(),
  state:      z.string(),
  running:    z.boolean(),
  port:       z.number().optional(),
  path:       z.string(),
  pid:        z.number().optional(),
  startedAt:  z.string().optional(),
  finishedAt: z.string().optional(),
});
export type MechaStatusResult = z.infer<typeof MechaStatusResult>;

export const DoctorResult = z.object({
  claudeCliAvailable: z.boolean(),
  sandboxSupported:   z.boolean(),
  issues:             z.array(z.string()),
});
export type DoctorResult = z.infer<typeof DoctorResult>;

export const UiUrlResult = z.object({
  url: z.string(),
});
export type UiUrlResult = z.infer<typeof UiUrlResult>;

export const McpEndpointResult = z.object({
  endpoint: z.string(),
  token:    z.string().optional(),
});
export type McpEndpointResult = z.infer<typeof McpEndpointResult>;

export const MechaTokenResult = z.object({
  id:    z.string(),
  token: z.string(),
});
export type MechaTokenResult = z.infer<typeof MechaTokenResult>;

export const MechaEnvResult = z.object({
  id:  z.string(),
  env: z.array(z.object({ key: z.string(), value: z.string() })),
});
export type MechaEnvResult = z.infer<typeof MechaEnvResult>;

export const MechaPruneResult = z.object({
  removedProcesses: z.array(z.string()),
});
export type MechaPruneResult = z.infer<typeof MechaPruneResult>;

export const MechaChatInput = z.object({
  id:      z.string().min(1),
  message: z.string().min(1),
});
export type MechaChatInput = z.infer<typeof MechaChatInput>;

// --- Session schemas ---

export const SessionUsage = z.object({
  totalCostUsd: z.number().nonnegative(),
  totalInputTokens: z.number().int().nonnegative(),
  totalOutputTokens: z.number().int().nonnegative(),
  totalDurationMs: z.number().int().nonnegative(),
  turnCount: z.number().int().nonnegative(),
});
export type SessionUsage = z.infer<typeof SessionUsage>;

export const SessionConfig = z.object({
  maxTurns:       z.number().int().positive().optional(),
  systemPrompt:   z.string().optional(),
  permissionMode: PermissionMode.optional(),
  model:          z.string().optional(),
  maxBudgetUsd:   z.number().positive().optional(),
});
export type SessionConfig = z.infer<typeof SessionConfig>;

export const SessionCreateInput = z.object({
  id:     z.string().min(1),
  title:  z.string().optional(),
  config: SessionConfig.optional(),
});
export type SessionCreateInput = z.infer<typeof SessionCreateInput>;

/** Shared base for session operations that identify a session within a mecha */
export const SessionRef = z.object({
  id:        z.string().min(1),
  sessionId: z.string().min(1),
});
export type SessionRef = z.infer<typeof SessionRef>;

export const SessionGetInput = SessionRef;
export type SessionGetInput = z.infer<typeof SessionGetInput>;

export const SessionDeleteInput = SessionRef;
export type SessionDeleteInput = z.infer<typeof SessionDeleteInput>;

export const SessionInterruptInput = SessionRef;
export type SessionInterruptInput = z.infer<typeof SessionInterruptInput>;

export const SessionMessageInput = SessionRef.extend({
  message: z.string().min(1),
});
export type SessionMessageInput = z.infer<typeof SessionMessageInput>;

export const SessionConfigUpdateInput = SessionRef.extend({
  config: SessionConfig,
});
export type SessionConfigUpdateInput = z.infer<typeof SessionConfigUpdateInput>;

export const SessionRenameInput = SessionRef.extend({
  title: z.string().min(1).max(200),
});
export type SessionRenameInput = z.infer<typeof SessionRenameInput>;

export const SessionListInput = z.object({
  id: z.string().min(1),
});
export type SessionListInput = z.infer<typeof SessionListInput>;

// --- Session metadata schemas ---

export const SessionMetaUpdate = z.object({
  customTitle: z.string().min(1).max(200).nullable().optional(),
  starred: z.boolean().nullable().optional(),
}).refine(
  (data) => data.customTitle !== undefined || data.starred !== undefined,
  { message: "At least one field required: customTitle or starred" },
);
export type SessionMetaUpdate = z.infer<typeof SessionMetaUpdate>;

// --- Channel schemas ---

export const ChannelType = z.enum(["telegram"]);
export type ChannelType = z.infer<typeof ChannelType>;

export const ChannelAddInput = z.object({
  type:     ChannelType,
  botToken: z.string().min(1),
});
export type ChannelAddInput = z.infer<typeof ChannelAddInput>;

export const ChannelLinkInput = z.object({
  channelId: z.string().min(1),
  chatId:    z.string().min(1),
  mechaId:   z.string().min(1),
});
export type ChannelLinkInput = z.infer<typeof ChannelLinkInput>;

export const ChannelUnlinkInput = z.object({
  channelId: z.string().min(1),
  chatId:    z.string().min(1),
});
export type ChannelUnlinkInput = z.infer<typeof ChannelUnlinkInput>;
