import { MechaError } from "@mecha/core";
import { ZodError } from "zod";

// --- New error classes ---

export class InvalidPortError extends MechaError {
  constructor(port: number) { super(`Invalid port: ${port} (must be 1024-65535)`, "INVALID_PORT"); }
}

export class InvalidPermissionModeError extends MechaError {
  constructor(mode: string) { super(`Invalid permission mode: ${mode} (must be one of: default, plan, full-auto)`, "INVALID_PERMISSION_MODE"); }
}

export class ContainerStartError extends MechaError {
  constructor(name: string, cause?: Error) {
    super(`Failed to start container ${name}: ${cause?.message ?? "unknown"}`, "CONTAINER_START_FAILED");
    if (cause) this.cause = cause;
  }
}

export class PathNotFoundError extends MechaError {
  constructor(path: string) { super(`Path does not exist: ${path}`, "PATH_NOT_FOUND"); }
}

export class PathNotDirectoryError extends MechaError {
  constructor(path: string) { super(`Path is not a directory: ${path}`, "PATH_NOT_DIRECTORY"); }
}

export class NoPortBindingError extends MechaError {
  constructor(id: string) { super(`No port binding found for mecha: ${id}`, "NO_PORT_BINDING"); }
}

export class ConfigureNoFieldsError extends MechaError {
  constructor() { super("At least one field required: claudeToken, anthropicApiKey, otp, permissionMode", "CONFIGURE_NO_FIELDS"); }
}

export class TokenNotFoundError extends MechaError {
  constructor(id: string) { super(`No auth token found for mecha: ${id}`, "TOKEN_NOT_FOUND"); }
}

export class ChatRequestFailedError extends MechaError {
  constructor(id: string, status: number, statusText: string) {
    super(`Chat failed for mecha ${id}: ${status} ${statusText}`, "CHAT_REQUEST_FAILED");
  }
}

export class SessionNotFoundError extends MechaError {
  constructor(sessionId: string) { super(`Session not found: ${sessionId}`, "SESSION_NOT_FOUND"); }
}

export class SessionBusyError extends MechaError {
  constructor(sessionId: string) { super(`Session is busy: ${sessionId}`, "SESSION_BUSY"); }
}

export class SessionCapReachedError extends MechaError {
  constructor() { super("Maximum number of sessions reached", "SESSION_CAP_REACHED"); }
}

export class EjectFileExistsError extends MechaError {
  constructor(path: string) { super(`File already exists: ${path}. Use --force to overwrite.`, "EJECT_FILE_EXISTS"); }
}

// --- Mesh / node errors ---

export class NodeUnreachableError extends MechaError {
  constructor(node: string) { super(`Node unreachable: ${node}`, "NODE_UNREACHABLE"); }
}

export class NodeAuthFailedError extends MechaError {
  constructor(node: string) { super(`Authentication failed for node: ${node}`, "NODE_AUTH_FAILED"); }
}

export class NodeRequestFailedError extends MechaError {
  constructor(node: string, status: number, cause?: Error) {
    super(`Request to node ${node} failed with status ${status}`, "NODE_REQUEST_FAILED");
    if (cause) this.cause = cause;
  }
}

export class MechaNotLocatedError extends MechaError {
  constructor(id: string) { super(`Mecha not found on any node: ${id}`, "MECHA_NOT_LOCATED"); }
}

// --- Channel errors ---

export class ChannelNotFoundError extends MechaError {
  constructor(id: string) { super(`Channel not found: ${id}`, "CHANNEL_NOT_FOUND"); }
}

export class ChannelLinkNotFoundError extends MechaError {
  constructor(channelId: string, chatId: string) { super(`No link found for channel ${channelId} chat ${chatId}`, "CHANNEL_LINK_NOT_FOUND"); }
}

export class ChannelLinkExistsError extends MechaError {
  constructor(channelId: string, chatId: string) { super(`Link already exists for channel ${channelId} chat ${chatId}`, "CHANNEL_LINK_EXISTS"); }
}

// --- Error mapping helpers ---

const HTTP_STATUS_MAP: Record<string, number> = {
  INVALID_PORT: 400,
  INVALID_PERMISSION_MODE: 400,
  PATH_NOT_FOUND: 400,
  PATH_NOT_DIRECTORY: 400,
  CONFIGURE_NO_FIELDS: 400,
  CONTAINER_NOT_FOUND: 404,
  CONTAINER_ALREADY_EXISTS: 409,
  CONTAINER_START_FAILED: 500,
  DOCKER_NOT_AVAILABLE: 503,
  NO_PORT_BINDING: 500,
  TOKEN_NOT_FOUND: 404,
  CHAT_REQUEST_FAILED: 502,
  INVALID_PATH: 400,
  IMAGE_NOT_FOUND: 500,
  SESSION_NOT_FOUND: 404,
  SESSION_BUSY: 409,
  SESSION_CAP_REACHED: 429,
  EJECT_FILE_EXISTS: 409,
  CHANNEL_NOT_FOUND: 404,
  CHANNEL_LINK_NOT_FOUND: 404,
  CHANNEL_LINK_EXISTS: 409,
  NODE_UNREACHABLE: 502,
  NODE_AUTH_FAILED: 403,
  NODE_REQUEST_FAILED: 502,
  MECHA_NOT_LOCATED: 404,
};

export function toHttpStatus(err: unknown): number {
  if (err instanceof MechaError) return HTTP_STATUS_MAP[err.code] ?? 500;
  if (err instanceof ZodError) return 400;
  return 500;
}

export function toExitCode(_err: unknown): number {
  return 1; // All errors are exit code 1 for CLI
}

export function toUserMessage(err: unknown): string {
  if (err instanceof ZodError) return `Validation error: ${err.issues.map(i => i.message).join("; ")}`;
  if (err instanceof MechaError) return err.message;
  if (err instanceof Error) return err.message;
  return "An unexpected error occurred";
}

/** Sanitized message safe for HTTP responses (hides internal details for non-domain errors) */
export function toSafeMessage(err: unknown): string {
  if (err instanceof ZodError) return `Validation error: ${err.issues.map(i => i.message).join("; ")}`;
  if (err instanceof MechaError) return err.message;
  return "Internal error";
}
