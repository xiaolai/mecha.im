import { describe, it, expect } from "vitest";
import {
  MechaError,
  InvalidAddressError,
  InvalidNameError,
  BotNotFoundError,
  BotAlreadyExistsError,
  BotNotRunningError,
  BotAlreadyRunningError,
  BotBusyError,
  PathNotFoundError,
  PathNotDirectoryError,
  PortConflictError,
  InvalidPortError,
  SessionNotFoundError,
  SessionBusyError,
  ProcessSpawnError,
  ProcessHealthTimeoutError,
  AuthProfileNotFoundError,
  AuthTokenExpiredError,
  AuthTokenInvalidError,
  AclDeniedError,
  IdentityNotFoundError,
  InvalidCapabilityError,
  NodeNotFoundError,
  DuplicateNodeError,
  AuthProfileAlreadyExistsError,
  ForwardingError,
  InvalidToolNameError,
  SessionFetchError,
  ChatRequestError,
  RemoteRoutingError,
  CorruptConfigError,
  PortRangeExhaustedError,
  GroupAddressNotSupportedError,
  ScheduleNotFoundError,
  DuplicateScheduleError,
  InvalidIntervalError,
  CliAlreadyRunningError,
  MeterProxyAlreadyRunningError,
  MeterProxyNotRunningError,
  MeterProxyRequiredError,
  ConnectError,
  InvalidInviteError,
  HandshakeError,
  PeerOfflineError,
  RendezvousError,
} from "../src/errors.js";

describe("MechaError base", () => {
  it("carries code, statusCode, and exitCode", () => {
    const err = new MechaError("test", {
      code: "TEST",
      statusCode: 418,
      exitCode: 42,
    });
    expect(err.message).toBe("test");
    expect(err.code).toBe("TEST");
    expect(err.statusCode).toBe(418);
    expect(err.exitCode).toBe(42);
    expect(err.name).toBe("MechaError");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(MechaError);
  });

});
// Cause chain tests live in error-cause.test.ts

describe("error classes", () => {
  const cases: Array<{
    name: string;
    error: MechaError;
    expectedStatus: number;
    expectedExit: number;
    expectedCode: string;
    messageContains: string;
  }> = [
    {
      name: "InvalidAddressError",
      error: new InvalidAddressError("bad@addr@oops"),
      expectedStatus: 400,
      expectedExit: 1,
      expectedCode: "INVALID_ADDRESS",
      messageContains: "bad@addr@oops",
    },
    {
      name: "InvalidNameError",
      error: new InvalidNameError("BAD"),
      expectedStatus: 400,
      expectedExit: 1,
      expectedCode: "INVALID_NAME",
      messageContains: "BAD",
    },
    {
      name: "BotNotFoundError",
      error: new BotNotFoundError("researcher"),
      expectedStatus: 404,
      expectedExit: 1,
      expectedCode: "BOT_NOT_FOUND",
      messageContains: "researcher",
    },
    {
      name: "BotAlreadyExistsError",
      error: new BotAlreadyExistsError("researcher"),
      expectedStatus: 409,
      expectedExit: 1,
      expectedCode: "BOT_ALREADY_EXISTS",
      messageContains: "already exists",
    },
    {
      name: "BotNotRunningError",
      error: new BotNotRunningError("researcher"),
      expectedStatus: 409,
      expectedExit: 1,
      expectedCode: "BOT_NOT_RUNNING",
      messageContains: "not running",
    },
    {
      name: "BotAlreadyRunningError",
      error: new BotAlreadyRunningError("researcher"),
      expectedStatus: 409,
      expectedExit: 1,
      expectedCode: "BOT_ALREADY_RUNNING",
      messageContains: "already running",
    },
    {
      name: "BotBusyError (plural)",
      error: new BotBusyError("researcher", 3),
      expectedStatus: 409,
      expectedExit: 1,
      expectedCode: "BOT_BUSY",
      messageContains: "3 active sessions",
    },
    {
      name: "BotBusyError (singular)",
      error: new BotBusyError("researcher", 1),
      expectedStatus: 409,
      expectedExit: 1,
      expectedCode: "BOT_BUSY",
      messageContains: "1 active session",
    },
    {
      name: "PathNotFoundError",
      error: new PathNotFoundError("/bad/path"),
      expectedStatus: 400,
      expectedExit: 1,
      expectedCode: "PATH_NOT_FOUND",
      messageContains: "/bad/path",
    },
    {
      name: "PathNotDirectoryError",
      error: new PathNotDirectoryError("/a/file"),
      expectedStatus: 400,
      expectedExit: 1,
      expectedCode: "PATH_NOT_DIRECTORY",
      messageContains: "/a/file",
    },
    {
      name: "PortConflictError",
      error: new PortConflictError(7700),
      expectedStatus: 409,
      expectedExit: 1,
      expectedCode: "PORT_CONFLICT",
      messageContains: "7700",
    },
    {
      name: "InvalidPortError",
      error: new InvalidPortError(-1),
      expectedStatus: 400,
      expectedExit: 1,
      expectedCode: "INVALID_PORT",
      messageContains: "-1",
    },
    {
      name: "SessionNotFoundError",
      error: new SessionNotFoundError("abc-123"),
      expectedStatus: 404,
      expectedExit: 1,
      expectedCode: "SESSION_NOT_FOUND",
      messageContains: "abc-123",
    },
    {
      name: "SessionBusyError",
      error: new SessionBusyError("abc-123"),
      expectedStatus: 409,
      expectedExit: 1,
      expectedCode: "SESSION_BUSY",
      messageContains: "abc-123",
    },
    {
      name: "AuthProfileNotFoundError",
      error: new AuthProfileNotFoundError("personal"),
      expectedStatus: 404,
      expectedExit: 1,
      expectedCode: "AUTH_PROFILE_NOT_FOUND",
      messageContains: "personal",
    },
    {
      name: "AuthTokenExpiredError",
      error: new AuthTokenExpiredError("personal", "2025-12-01"),
      expectedStatus: 401,
      expectedExit: 1,
      expectedCode: "AUTH_TOKEN_EXPIRED",
      messageContains: "expired on 2025-12-01",
    },
    {
      name: "AuthTokenInvalidError",
      error: new AuthTokenInvalidError("personal"),
      expectedStatus: 401,
      expectedExit: 1,
      expectedCode: "AUTH_TOKEN_INVALID",
      messageContains: "invalid",
    },
    {
      name: "ProcessSpawnError",
      error: new ProcessSpawnError("binary not found"),
      expectedStatus: 500,
      expectedExit: 2,
      expectedCode: "PROCESS_SPAWN_ERROR",
      messageContains: "binary not found",
    },
    {
      name: "ProcessHealthTimeoutError",
      error: new ProcessHealthTimeoutError("researcher"),
      expectedStatus: 500,
      expectedExit: 2,
      expectedCode: "PROCESS_HEALTH_TIMEOUT",
      messageContains: "researcher",
    },
    {
      name: "AclDeniedError",
      error: new AclDeniedError("coder", "query", "researcher"),
      expectedStatus: 403,
      expectedExit: 3,
      expectedCode: "ACL_DENIED",
      messageContains: "coder cannot query researcher",
    },
    {
      name: "IdentityNotFoundError",
      error: new IdentityNotFoundError("alice"),
      expectedStatus: 404,
      expectedExit: 1,
      expectedCode: "IDENTITY_NOT_FOUND",
      messageContains: "alice",
    },
    {
      name: "InvalidCapabilityError",
      error: new InvalidCapabilityError("bad_cap"),
      expectedStatus: 400,
      expectedExit: 2,
      expectedCode: "INVALID_CAPABILITY",
      messageContains: "bad_cap",
    },
    {
      name: "NodeNotFoundError",
      error: new NodeNotFoundError("remote-1"),
      expectedStatus: 404,
      expectedExit: 1,
      expectedCode: "NODE_NOT_FOUND",
      messageContains: "remote-1",
    },
    {
      name: "DuplicateNodeError",
      error: new DuplicateNodeError("alice"),
      expectedStatus: 409,
      expectedExit: 1,
      expectedCode: "DUPLICATE_NODE",
      messageContains: "already registered",
    },
    {
      name: "AuthProfileAlreadyExistsError",
      error: new AuthProfileAlreadyExistsError("prod"),
      expectedStatus: 409,
      expectedExit: 1,
      expectedCode: "AUTH_PROFILE_ALREADY_EXISTS",
      messageContains: "already exists",
    },
    {
      name: "ForwardingError",
      error: new ForwardingError(502),
      expectedStatus: 502,
      expectedExit: 2,
      expectedCode: "FORWARDING_ERROR",
      messageContains: "retry shortly",
    },
    {
      name: "ForwardingError (401)",
      error: new ForwardingError(401),
      expectedStatus: 502,
      expectedExit: 2,
      expectedCode: "FORWARDING_ERROR",
      messageContains: "check auth token",
    },
    {
      name: "ForwardingError (503)",
      error: new ForwardingError(503),
      expectedStatus: 502,
      expectedExit: 2,
      expectedCode: "FORWARDING_ERROR",
      messageContains: "retry shortly",
    },
    {
      name: "ForwardingError (generic)",
      error: new ForwardingError(500),
      expectedStatus: 502,
      expectedExit: 2,
      expectedCode: "FORWARDING_ERROR",
      messageContains: "HTTP 500",
    },
    {
      name: "InvalidToolNameError",
      error: new InvalidToolNameError("bad..tool"),
      expectedStatus: 400,
      expectedExit: 1,
      expectedCode: "INVALID_TOOL_NAME",
      messageContains: "bad..tool",
    },
    {
      name: "SessionFetchError",
      error: new SessionFetchError("list", 500),
      expectedStatus: 502,
      expectedExit: 2,
      expectedCode: "SESSION_FETCH_ERROR",
      messageContains: "500",
    },
    {
      name: "ChatRequestError",
      error: new ChatRequestError(500, "upstream failed"),
      expectedStatus: 502,
      expectedExit: 2,
      expectedCode: "CHAT_REQUEST_ERROR",
      messageContains: "upstream failed",
    },
    {
      name: "ChatRequestError (default message)",
      error: new ChatRequestError(503, ""),
      expectedStatus: 502,
      expectedExit: 2,
      expectedCode: "CHAT_REQUEST_ERROR",
      messageContains: "Chat request failed: 503",
    },
    {
      name: "RemoteRoutingError",
      error: new RemoteRoutingError("bob", 502),
      expectedStatus: 502,
      expectedExit: 2,
      expectedCode: "REMOTE_ROUTING_ERROR",
      messageContains: "bob",
    },
    {
      name: "CorruptConfigError",
      error: new CorruptConfigError("node.json"),
      expectedStatus: 500,
      expectedExit: 1,
      expectedCode: "CORRUPT_CONFIG",
      messageContains: "node.json",
    },
    {
      name: "PortRangeExhaustedError",
      error: new PortRangeExhaustedError(7700, 7799),
      expectedStatus: 503,
      expectedExit: 2,
      expectedCode: "PORT_RANGE_EXHAUSTED",
      messageContains: "7700-7799",
    },
    {
      name: "GroupAddressNotSupportedError",
      error: new GroupAddressNotSupportedError("+team"),
      expectedStatus: 400,
      expectedExit: 1,
      expectedCode: "GROUP_ADDRESS_NOT_SUPPORTED",
      messageContains: "+team",
    },
    {
      name: "ScheduleNotFoundError",
      error: new ScheduleNotFoundError("inbox-check"),
      expectedStatus: 404,
      expectedExit: 1,
      expectedCode: "SCHEDULE_NOT_FOUND",
      messageContains: "inbox-check",
    },
    {
      name: "DuplicateScheduleError",
      error: new DuplicateScheduleError("daily-sync"),
      expectedStatus: 409,
      expectedExit: 1,
      expectedCode: "DUPLICATE_SCHEDULE",
      messageContains: "daily-sync",
    },
    {
      name: "InvalidIntervalError",
      error: new InvalidIntervalError("2s"),
      expectedStatus: 400,
      expectedExit: 1,
      expectedCode: "INVALID_INTERVAL",
      messageContains: "2s",
    },
    {
      name: "CliAlreadyRunningError",
      error: new CliAlreadyRunningError(54321),
      expectedStatus: 409,
      expectedExit: 1,
      expectedCode: "CLI_ALREADY_RUNNING",
      messageContains: "54321",
    },
    {
      name: "MeterProxyAlreadyRunningError",
      error: new MeterProxyAlreadyRunningError(12345),
      expectedStatus: 409,
      expectedExit: 1,
      expectedCode: "METER_PROXY_ALREADY_RUNNING",
      messageContains: "12345",
    },
    {
      name: "MeterProxyNotRunningError",
      error: new MeterProxyNotRunningError(),
      expectedStatus: 409,
      expectedExit: 1,
      expectedCode: "METER_PROXY_NOT_RUNNING",
      messageContains: "not running",
    },
    {
      name: "MeterProxyRequiredError",
      error: new MeterProxyRequiredError(),
      expectedStatus: 503,
      expectedExit: 2,
      expectedCode: "METER_PROXY_REQUIRED",
      messageContains: "mecha meter start",
    },
    // Phase 6 — Connectivity errors
    {
      name: "ConnectError",
      error: new ConnectError("timeout"),
      expectedStatus: 503,
      expectedExit: 1,
      expectedCode: "CONNECT_ERROR",
      messageContains: "timeout",
    },
    {
      name: "InvalidInviteError",
      error: new InvalidInviteError("Invite expired"),
      expectedStatus: 400,
      expectedExit: 1,
      expectedCode: "INVALID_INVITE",
      messageContains: "Invite expired",
    },
    {
      name: "HandshakeError",
      error: new HandshakeError("key mismatch"),
      expectedStatus: 502,
      expectedExit: 1,
      expectedCode: "HANDSHAKE_ERROR",
      messageContains: "key mismatch",
    },
    {
      name: "PeerOfflineError",
      error: new PeerOfflineError("bob"),
      expectedStatus: 503,
      expectedExit: 1,
      expectedCode: "PEER_OFFLINE",
      messageContains: "bob",
    },
    {
      name: "RendezvousError",
      error: new RendezvousError("connection refused"),
      expectedStatus: 502,
      expectedExit: 1,
      expectedCode: "RENDEZVOUS_ERROR",
      messageContains: "connection refused",
    },
  ];

  for (const c of cases) {
    describe(c.name, () => {
      it(`has statusCode ${c.expectedStatus}`, () => {
        expect(c.error.statusCode).toBe(c.expectedStatus);
      });

      it(`has exitCode ${c.expectedExit}`, () => {
        expect(c.error.exitCode).toBe(c.expectedExit);
      });

      it(`has code ${c.expectedCode}`, () => {
        expect(c.error.code).toBe(c.expectedCode);
      });

      it("message contains expected content", () => {
        expect(c.error.message).toContain(c.messageContains);
      });

      it("is instanceof MechaError", () => {
        expect(c.error).toBeInstanceOf(MechaError);
      });

      it("is instanceof Error", () => {
        expect(c.error).toBeInstanceOf(Error);
      });
    });
  }
});
