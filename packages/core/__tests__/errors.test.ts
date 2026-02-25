import { describe, it, expect } from "vitest";
import {
  MechaError,
  InvalidAddressError,
  InvalidNameError,
  CasaNotFoundError,
  CasaAlreadyExistsError,
  CasaNotRunningError,
  CasaAlreadyRunningError,
  PathNotFoundError,
  PathNotDirectoryError,
  PortConflictError,
  InvalidPortError,
  SessionNotFoundError,
  SessionBusyError,
  ProcessSpawnError,
  ProcessHealthTimeoutError,
  NodeUnreachableError,
  NodeAuthFailedError,
  CasaNotLocatedError,
  AuthProfileNotFoundError,
  AuthTokenExpiredError,
  AuthTokenInvalidError,
  AclDeniedError,
  IdentityNotFoundError,
  InvalidCapabilityError,
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
      name: "CasaNotFoundError",
      error: new CasaNotFoundError("researcher"),
      expectedStatus: 404,
      expectedExit: 1,
      expectedCode: "CASA_NOT_FOUND",
      messageContains: "researcher",
    },
    {
      name: "CasaAlreadyExistsError",
      error: new CasaAlreadyExistsError("researcher"),
      expectedStatus: 409,
      expectedExit: 1,
      expectedCode: "CASA_ALREADY_EXISTS",
      messageContains: "already exists",
    },
    {
      name: "CasaNotRunningError",
      error: new CasaNotRunningError("researcher"),
      expectedStatus: 409,
      expectedExit: 1,
      expectedCode: "CASA_NOT_RUNNING",
      messageContains: "not running",
    },
    {
      name: "CasaAlreadyRunningError",
      error: new CasaAlreadyRunningError("researcher"),
      expectedStatus: 409,
      expectedExit: 1,
      expectedCode: "CASA_ALREADY_RUNNING",
      messageContains: "already running",
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
      name: "NodeUnreachableError",
      error: new NodeUnreachableError("alice"),
      expectedStatus: 502,
      expectedExit: 2,
      expectedCode: "NODE_UNREACHABLE",
      messageContains: "alice",
    },
    {
      name: "NodeAuthFailedError",
      error: new NodeAuthFailedError("alice"),
      expectedStatus: 401,
      expectedExit: 2,
      expectedCode: "NODE_AUTH_FAILED",
      messageContains: "alice",
    },
    {
      name: "CasaNotLocatedError",
      error: new CasaNotLocatedError("researcher@alice"),
      expectedStatus: 404,
      expectedExit: 2,
      expectedCode: "CASA_NOT_LOCATED",
      messageContains: "researcher@alice",
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
