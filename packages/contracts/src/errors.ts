// Re-export base error and InvalidNameError from @mecha/core (canonical source)
export { MechaError, InvalidNameError } from "@mecha/core";
import { MechaError } from "@mecha/core";

// --- Address errors ---

export class InvalidAddressError extends MechaError {
  constructor(input: string) {
    super(`Invalid address: "${input}"`, {
      code: "INVALID_ADDRESS",
      statusCode: 400,
      exitCode: 1,
    });
  }
}

// --- CASA lifecycle errors ---

export class CasaNotFoundError extends MechaError {
  constructor(name: string) {
    super(`CASA "${name}" not found`, {
      code: "CASA_NOT_FOUND",
      statusCode: 404,
      exitCode: 1,
    });
  }
}

export class CasaAlreadyExistsError extends MechaError {
  constructor(name: string) {
    super(`CASA "${name}" already exists`, {
      code: "CASA_ALREADY_EXISTS",
      statusCode: 409,
      exitCode: 1,
    });
  }
}

export class CasaNotRunningError extends MechaError {
  constructor(name: string) {
    super(`CASA "${name}" is not running`, {
      code: "CASA_NOT_RUNNING",
      statusCode: 409,
      exitCode: 1,
    });
  }
}

export class CasaAlreadyRunningError extends MechaError {
  constructor(name: string) {
    super(`CASA "${name}" is already running`, {
      code: "CASA_ALREADY_RUNNING",
      statusCode: 409,
      exitCode: 1,
    });
  }
}

// --- Path errors ---

export class PathNotFoundError extends MechaError {
  constructor(path: string) {
    super(`Path not found: "${path}"`, {
      code: "PATH_NOT_FOUND",
      statusCode: 400,
      exitCode: 1,
    });
  }
}

export class PathNotDirectoryError extends MechaError {
  constructor(path: string) {
    super(`Path is not a directory: "${path}"`, {
      code: "PATH_NOT_DIRECTORY",
      statusCode: 400,
      exitCode: 1,
    });
  }
}

// --- Port errors ---

export class PortConflictError extends MechaError {
  constructor(port: number) {
    super(`Port ${port} is already in use`, {
      code: "PORT_CONFLICT",
      statusCode: 409,
      exitCode: 1,
    });
  }
}

export class InvalidPortError extends MechaError {
  constructor(port: number) {
    super(`Invalid port: ${port}`, {
      code: "INVALID_PORT",
      statusCode: 400,
      exitCode: 1,
    });
  }
}

// --- Session errors ---

export class SessionNotFoundError extends MechaError {
  constructor(id: string) {
    super(`Session "${id}" not found`, {
      code: "SESSION_NOT_FOUND",
      statusCode: 404,
      exitCode: 1,
    });
  }
}

export class SessionBusyError extends MechaError {
  constructor(id: string) {
    super(`Session "${id}" is busy`, {
      code: "SESSION_BUSY",
      statusCode: 409,
      exitCode: 1,
    });
  }
}

// --- Auth errors ---

export class AuthProfileNotFoundError extends MechaError {
  constructor(name: string) {
    super(`Auth profile "${name}" not found`, {
      code: "AUTH_PROFILE_NOT_FOUND",
      statusCode: 404,
      exitCode: 1,
    });
  }
}

export class AuthTokenExpiredError extends MechaError {
  constructor(profile: string, date: string) {
    super(`Auth token "${profile}" expired on ${date}`, {
      code: "AUTH_TOKEN_EXPIRED",
      statusCode: 401,
      exitCode: 1,
    });
  }
}

export class AuthTokenInvalidError extends MechaError {
  constructor(profile: string) {
    super(`Auth token "${profile}" is invalid`, {
      code: "AUTH_TOKEN_INVALID",
      statusCode: 401,
      exitCode: 1,
    });
  }
}

// --- Process errors ---

export class ProcessSpawnError extends MechaError {
  constructor(reason: string) {
    super(`Failed to spawn CASA: ${reason}`, {
      code: "PROCESS_SPAWN_ERROR",
      statusCode: 500,
      exitCode: 2,
    });
  }
}

export class ProcessHealthTimeoutError extends MechaError {
  constructor(name: string) {
    super(`CASA "${name}" failed health check`, {
      code: "PROCESS_HEALTH_TIMEOUT",
      statusCode: 500,
      exitCode: 2,
    });
  }
}

// --- Node errors (Phase 4) ---

export class NodeUnreachableError extends MechaError {
  constructor(name: string) {
    super(`Node "${name}" is unreachable`, {
      code: "NODE_UNREACHABLE",
      statusCode: 502,
      exitCode: 2,
    });
  }
}

export class NodeAuthFailedError extends MechaError {
  constructor(name: string) {
    super(`Authentication failed for node "${name}"`, {
      code: "NODE_AUTH_FAILED",
      statusCode: 401,
      exitCode: 2,
    });
  }
}

export class CasaNotLocatedError extends MechaError {
  constructor(address: string) {
    super(`Cannot locate CASA: "${address}"`, {
      code: "CASA_NOT_LOCATED",
      statusCode: 404,
      exitCode: 2,
    });
  }
}

// --- ACL errors (Phase 3) ---

export class AclDeniedError extends MechaError {
  constructor(source: string, capability: string, target: string) {
    super(`Access denied: ${source} cannot ${capability} ${target}`, {
      code: "ACL_DENIED",
      statusCode: 403,
      exitCode: 3,
    });
  }
}
