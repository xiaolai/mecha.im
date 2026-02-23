import { describe, it, expect } from "vitest";
import { ZodError, z } from "zod";
import {
  MechaError,
  ContainerNotFoundError,
  DockerNotAvailableError,
  ContainerAlreadyExistsError,
  InvalidPathError,
  ImageNotFoundError,
} from "@mecha/core";
import {
  InvalidPortError,
  InvalidPermissionModeError,
  ContainerStartError,
  PathNotFoundError,
  PathNotDirectoryError,
  NoPortBindingError,
  ConfigureNoFieldsError,
  TokenNotFoundError,
  ChatRequestFailedError,
  SessionNotFoundError,
  SessionBusyError,
  SessionCapReachedError,
  EjectFileExistsError,
  ChannelNotFoundError,
  ChannelLinkNotFoundError,
  ChannelLinkExistsError,
  NodeUnreachableError,
  NodeAuthFailedError,
  NodeRequestFailedError,
  MechaNotLocatedError,
  toHttpStatus,
  toExitCode,
  toUserMessage,
  toSafeMessage,
} from "../src/errors.js";

describe("error classes", () => {
  it("InvalidPortError has correct message and code", () => {
    const err = new InvalidPortError(80);
    expect(err.message).toBe("Invalid port: 80 (must be 1024-65535)");
    expect(err.code).toBe("INVALID_PORT");
    expect(err).toBeInstanceOf(MechaError);
    expect(err).toBeInstanceOf(Error);
  });

  it("InvalidPermissionModeError has correct message and code", () => {
    const err = new InvalidPermissionModeError("yolo");
    expect(err.message).toBe("Invalid permission mode: yolo (must be one of: default, plan, full-auto)");
    expect(err.code).toBe("INVALID_PERMISSION_MODE");
    expect(err).toBeInstanceOf(MechaError);
  });

  it("ContainerStartError includes cause", () => {
    const cause = new Error("port already in use");
    const err = new ContainerStartError("mecha-mx-foo", cause);
    expect(err.message).toBe("Failed to start container mecha-mx-foo: port already in use");
    expect(err.code).toBe("CONTAINER_START_FAILED");
    expect(err.cause).toBe(cause);
  });

  it("ContainerStartError without cause", () => {
    const err = new ContainerStartError("mecha-mx-foo");
    expect(err.message).toBe("Failed to start container mecha-mx-foo: unknown");
    expect(err.cause).toBeUndefined();
  });

  it("PathNotFoundError has correct message and code", () => {
    const err = new PathNotFoundError("/nonexistent");
    expect(err.message).toBe("Path does not exist: /nonexistent");
    expect(err.code).toBe("PATH_NOT_FOUND");
  });

  it("PathNotDirectoryError has correct message and code", () => {
    const err = new PathNotDirectoryError("/tmp/file.txt");
    expect(err.message).toBe("Path is not a directory: /tmp/file.txt");
    expect(err.code).toBe("PATH_NOT_DIRECTORY");
  });

  it("NoPortBindingError has correct message and code", () => {
    const err = new NoPortBindingError("mx-foo");
    expect(err.message).toBe("No port binding found for mecha: mx-foo");
    expect(err.code).toBe("NO_PORT_BINDING");
  });

  it("ConfigureNoFieldsError has correct message and code", () => {
    const err = new ConfigureNoFieldsError();
    expect(err.message).toBe("At least one field required: claudeToken, anthropicApiKey, otp, permissionMode");
    expect(err.code).toBe("CONFIGURE_NO_FIELDS");
  });

  it("TokenNotFoundError has correct message and code", () => {
    const err = new TokenNotFoundError("mx-foo");
    expect(err.message).toBe("No auth token found for mecha: mx-foo");
    expect(err.code).toBe("TOKEN_NOT_FOUND");
    expect(err).toBeInstanceOf(MechaError);
  });

  it("ChatRequestFailedError has correct message and code", () => {
    const err = new ChatRequestFailedError("mx-foo", 502, "Bad Gateway");
    expect(err.message).toBe("Chat failed for mecha mx-foo: 502 Bad Gateway");
    expect(err.code).toBe("CHAT_REQUEST_FAILED");
    expect(err).toBeInstanceOf(MechaError);
  });

  it("SessionNotFoundError has correct message and code", () => {
    const err = new SessionNotFoundError("sess-abc");
    expect(err.message).toBe("Session not found: sess-abc");
    expect(err.code).toBe("SESSION_NOT_FOUND");
    expect(err).toBeInstanceOf(MechaError);
    expect(err).toBeInstanceOf(Error);
  });

  it("SessionBusyError has correct message and code", () => {
    const err = new SessionBusyError("sess-abc");
    expect(err.message).toBe("Session is busy: sess-abc");
    expect(err.code).toBe("SESSION_BUSY");
    expect(err).toBeInstanceOf(MechaError);
  });

  it("SessionCapReachedError has correct message and code", () => {
    const err = new SessionCapReachedError();
    expect(err.message).toBe("Maximum number of sessions reached");
    expect(err.code).toBe("SESSION_CAP_REACHED");
    expect(err).toBeInstanceOf(MechaError);
  });

  it("EjectFileExistsError has correct message and code", () => {
    const err = new EjectFileExistsError("/tmp/docker-compose.yml");
    expect(err.message).toBe("File already exists: /tmp/docker-compose.yml. Use --force to overwrite.");
    expect(err.code).toBe("EJECT_FILE_EXISTS");
    expect(err).toBeInstanceOf(MechaError);
  });

  it("ChannelNotFoundError has correct message and code", () => {
    const err = new ChannelNotFoundError("ch-abc");
    expect(err.message).toBe("Channel not found: ch-abc");
    expect(err.code).toBe("CHANNEL_NOT_FOUND");
    expect(err).toBeInstanceOf(MechaError);
  });

  it("ChannelLinkNotFoundError has correct message and code", () => {
    const err = new ChannelLinkNotFoundError("ch-abc", "12345");
    expect(err.message).toBe("No link found for channel ch-abc chat 12345");
    expect(err.code).toBe("CHANNEL_LINK_NOT_FOUND");
    expect(err).toBeInstanceOf(MechaError);
  });

  it("ChannelLinkExistsError has correct message and code", () => {
    const err = new ChannelLinkExistsError("ch-abc", "12345");
    expect(err.message).toBe("Link already exists for channel ch-abc chat 12345");
    expect(err.code).toBe("CHANNEL_LINK_EXISTS");
    expect(err).toBeInstanceOf(MechaError);
  });

  it("NodeUnreachableError has correct message and code", () => {
    const err = new NodeUnreachableError("gpu-server");
    expect(err.message).toBe("Node unreachable: gpu-server");
    expect(err.code).toBe("NODE_UNREACHABLE");
    expect(err).toBeInstanceOf(MechaError);
    expect(err).toBeInstanceOf(Error);
  });

  it("NodeAuthFailedError has correct message and code", () => {
    const err = new NodeAuthFailedError("gpu-server");
    expect(err.message).toBe("Authentication failed for node: gpu-server");
    expect(err.code).toBe("NODE_AUTH_FAILED");
    expect(err).toBeInstanceOf(MechaError);
  });

  it("NodeRequestFailedError has correct message, code, and cause", () => {
    const cause = new Error("timeout");
    const err = new NodeRequestFailedError("gpu-server", 504, cause);
    expect(err.message).toBe("Request to node gpu-server failed with status 504");
    expect(err.code).toBe("NODE_REQUEST_FAILED");
    expect(err.cause).toBe(cause);
    expect(err).toBeInstanceOf(MechaError);
  });

  it("NodeRequestFailedError without cause", () => {
    const err = new NodeRequestFailedError("gpu-server", 500);
    expect(err.message).toBe("Request to node gpu-server failed with status 500");
    expect(err.cause).toBeUndefined();
  });

  it("MechaNotLocatedError has correct message and code", () => {
    const err = new MechaNotLocatedError("mx-foo-abc");
    expect(err.message).toBe("Mecha not found on any node: mx-foo-abc");
    expect(err.code).toBe("MECHA_NOT_LOCATED");
    expect(err).toBeInstanceOf(MechaError);
  });
});

describe("toHttpStatus", () => {
  it("maps MechaError codes to HTTP status", () => {
    expect(toHttpStatus(new InvalidPortError(80))).toBe(400);
    expect(toHttpStatus(new InvalidPermissionModeError("x"))).toBe(400);
    expect(toHttpStatus(new PathNotFoundError("/x"))).toBe(400);
    expect(toHttpStatus(new PathNotDirectoryError("/x"))).toBe(400);
    expect(toHttpStatus(new ConfigureNoFieldsError())).toBe(400);
    expect(toHttpStatus(new ContainerNotFoundError("x"))).toBe(404);
    expect(toHttpStatus(new ContainerAlreadyExistsError("x"))).toBe(409);
    expect(toHttpStatus(new ContainerStartError("x"))).toBe(500);
    expect(toHttpStatus(new DockerNotAvailableError())).toBe(503);
    expect(toHttpStatus(new NoPortBindingError("x"))).toBe(500);
    expect(toHttpStatus(new InvalidPathError("/x"))).toBe(400);
    expect(toHttpStatus(new ImageNotFoundError("x"))).toBe(500);
    expect(toHttpStatus(new TokenNotFoundError("x"))).toBe(404);
    expect(toHttpStatus(new ChatRequestFailedError("x", 500, "error"))).toBe(502);
    expect(toHttpStatus(new SessionNotFoundError("s"))).toBe(404);
    expect(toHttpStatus(new SessionBusyError("s"))).toBe(409);
    expect(toHttpStatus(new SessionCapReachedError())).toBe(429);
    expect(toHttpStatus(new EjectFileExistsError("/x"))).toBe(409);
    expect(toHttpStatus(new ChannelNotFoundError("ch"))).toBe(404);
    expect(toHttpStatus(new ChannelLinkNotFoundError("ch", "c"))).toBe(404);
    expect(toHttpStatus(new ChannelLinkExistsError("ch", "c"))).toBe(409);
    expect(toHttpStatus(new NodeUnreachableError("n"))).toBe(502);
    expect(toHttpStatus(new NodeAuthFailedError("n"))).toBe(403);
    expect(toHttpStatus(new NodeRequestFailedError("n", 500))).toBe(502);
    expect(toHttpStatus(new MechaNotLocatedError("mx"))).toBe(404);
  });

  it("maps ZodError to 400", () => {
    try {
      z.string().min(1).parse("");
    } catch (err) {
      expect(toHttpStatus(err)).toBe(400);
    }
  });

  it("maps unknown MechaError code to 500", () => {
    const err = new MechaError("custom", "UNKNOWN_CODE");
    expect(toHttpStatus(err)).toBe(500);
  });

  it("maps non-Error to 500", () => {
    expect(toHttpStatus("string error")).toBe(500);
    expect(toHttpStatus(null)).toBe(500);
    expect(toHttpStatus(42)).toBe(500);
  });
});

describe("toExitCode", () => {
  it("returns 1 for all errors", () => {
    expect(toExitCode(new InvalidPortError(80))).toBe(1);
    expect(toExitCode(new Error("generic"))).toBe(1);
    expect(toExitCode("string")).toBe(1);
  });
});

describe("toUserMessage", () => {
  it("formats ZodError with issue messages", () => {
    try {
      z.object({ name: z.string().min(1) }).parse({ name: "" });
    } catch (err) {
      const msg = toUserMessage(err);
      expect(msg).toMatch(/^Validation error:/);
      expect(msg.length).toBeGreaterThan("Validation error: ".length);
    }
  });

  it("returns Error.message for regular errors", () => {
    expect(toUserMessage(new InvalidPortError(80))).toBe("Invalid port: 80 (must be 1024-65535)");
    expect(toUserMessage(new Error("boom"))).toBe("boom");
  });

  it("returns fallback for non-Error values", () => {
    expect(toUserMessage("string")).toBe("An unexpected error occurred");
    expect(toUserMessage(null)).toBe("An unexpected error occurred");
    expect(toUserMessage(undefined)).toBe("An unexpected error occurred");
  });
});

describe("toSafeMessage", () => {
  it("returns domain error messages for MechaError", () => {
    expect(toSafeMessage(new InvalidPortError(80))).toBe("Invalid port: 80 (must be 1024-65535)");
  });

  it("formats ZodError with issue messages", () => {
    try {
      z.object({ name: z.string().min(1) }).parse({ name: "" });
    } catch (err) {
      expect(toSafeMessage(err)).toMatch(/^Validation error:/);
    }
  });

  it("hides internal error details for non-domain errors", () => {
    expect(toSafeMessage(new Error("Docker socket /var/run/docker.sock failed"))).toBe("Internal error");
    expect(toSafeMessage("string")).toBe("Internal error");
    expect(toSafeMessage(null)).toBe("Internal error");
  });
});
