---
title: Error Reference
description: Complete catalog of all MechaError subclasses with error codes, HTTP status codes, and CLI exit codes.
---

# Error Reference

[[toc]]

All errors in Mecha extend the `MechaError` base class from `@mecha/core`. Each error carries three properties that enable consistent handling across CLI and HTTP surfaces:

| Property | Type | Description |
|----------|------|-------------|
| `code` | `string` | Machine-readable error code (e.g., `BOT_NOT_FOUND`) |
| `statusCode` | `number` | HTTP status code for API responses |
| `exitCode` | `number` | CLI process exit code |

## `MechaError` (Base Class)

```ts
class MechaError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly exitCode: number;

  constructor(
    message: string,
    opts: { code: string; statusCode: number; exitCode: number; cause?: unknown }
  );
}
```

All errors below extend `MechaError`. Use `instanceof MechaError` to catch any Mecha error, or check the `code` property for specific handling.

```ts
import { MechaError, BotNotFoundError } from "@mecha/core";

try {
  // ... operation
} catch (err) {
  if (err instanceof MechaError) {
    console.error(`[${err.code}] ${err.message}`);
    process.exit(err.exitCode);
  }
}
```

## Name & Address Errors

| Error Class | Code | HTTP | Exit | Constructor | Message |
|-------------|------|------|------|-------------|---------|
| `InvalidNameError` | `INVALID_NAME` | 400 | 1 | `(input)` | Invalid name: must be lowercase, alphanumeric, hyphens |
| `InvalidAddressError` | `INVALID_ADDRESS` | 400 | 1 | `(input)` | Invalid address format |
| `GroupAddressNotSupportedError` | `GROUP_ADDRESS_NOT_SUPPORTED` | 400 | 1 | `(input)` | Group addresses are not supported yet |

## Bot Lifecycle Errors

| Error Class | Code | HTTP | Exit | Constructor | Message |
|-------------|------|------|------|-------------|---------|
| `BotNotFoundError` | `BOT_NOT_FOUND` | 404 | 1 | `(name)` | Bot not found |
| `BotAlreadyExistsError` | `BOT_ALREADY_EXISTS` | 409 | 1 | `(name)` | Bot already exists |
| `BotNotRunningError` | `BOT_NOT_RUNNING` | 409 | 1 | `(name)` | Bot is not running |
| `BotAlreadyRunningError` | `BOT_ALREADY_RUNNING` | 409 | 1 | `(name)` | Bot is already running |
| `BotBusyError` | `BOT_BUSY` | 409 | 1 | `(name, sessionCount)` | Bot has active sessions -- use `--force` to override |

## Path Errors

| Error Class | Code | HTTP | Exit | Constructor | Message |
|-------------|------|------|------|-------------|---------|
| `PathNotFoundError` | `PATH_NOT_FOUND` | 400 | 1 | `(path)` | Path not found |
| `PathNotDirectoryError` | `PATH_NOT_DIRECTORY` | 400 | 1 | `(path)` | Path is not a directory |

## Port Errors

| Error Class | Code | HTTP | Exit | Constructor | Message |
|-------------|------|------|------|-------------|---------|
| `PortConflictError` | `PORT_CONFLICT` | 409 | 1 | `(port)` | Port is already in use |
| `InvalidPortError` | `INVALID_PORT` | 400 | 1 | `(port)` | Invalid port number |
| `PortRangeExhaustedError` | `PORT_RANGE_EXHAUSTED` | 503 | 2 | `(base, max)` | No available port in range |

## Session Errors

| Error Class | Code | HTTP | Exit | Constructor | Message |
|-------------|------|------|------|-------------|---------|
| `SessionNotFoundError` | `SESSION_NOT_FOUND` | 404 | 1 | `(id)` | Session not found |
| `SessionBusyError` | `SESSION_BUSY` | 409 | 1 | `(id)` | Session is busy |
| `SessionFetchError` | `SESSION_FETCH_ERROR` | 502 | 2 | `(operation, status)` | Failed to fetch sessions from upstream |

## Auth Errors

| Error Class | Code | HTTP | Exit | Constructor | Message |
|-------------|------|------|------|-------------|---------|
| `AuthProfileNotFoundError` | `AUTH_PROFILE_NOT_FOUND` | 404 | 1 | `(name)` | Auth profile not found |
| `AuthProfileAlreadyExistsError` | `AUTH_PROFILE_ALREADY_EXISTS` | 409 | 1 | `(name)` | Auth profile already exists |
| `AuthTokenExpiredError` | `AUTH_TOKEN_EXPIRED` | 401 | 1 | `(profile, date)` | Auth token expired |
| `AuthTokenInvalidError` | `AUTH_TOKEN_INVALID` | 401 | 1 | `(profile)` | Auth token is invalid |

## Process Errors

| Error Class | Code | HTTP | Exit | Constructor | Message |
|-------------|------|------|------|-------------|---------|
| `ProcessSpawnError` | `PROCESS_SPAWN_ERROR` | 500 | 2 | `(reason)` | Failed to spawn bot |
| `ProcessHealthTimeoutError` | `PROCESS_HEALTH_TIMEOUT` | 500 | 2 | `(name)` | Bot failed health check |
| `CliAlreadyRunningError` | `CLI_ALREADY_RUNNING` | 409 | 1 | `(pid)` | Another CLI instance is already running |

## ACL Errors

| Error Class | Code | HTTP | Exit | Constructor | Message |
|-------------|------|------|------|-------------|---------|
| `AclDeniedError` | `ACL_DENIED` | 403 | 3 | `(source, capability, target)` | Access denied |
| `InvalidCapabilityError` | `INVALID_CAPABILITY` | 400 | 2 | `(capability)` | Invalid capability string |

## Node & Routing Errors

| Error Class | Code | HTTP | Exit | Constructor | Message |
|-------------|------|------|------|-------------|---------|
| `NodeNotFoundError` | `NODE_NOT_FOUND` | 404 | 1 | `(name)` | Node not found |
| `DuplicateNodeError` | `DUPLICATE_NODE` | 409 | 1 | `(name)` | Node already registered |
| `ForwardingError` | `FORWARDING_ERROR` | 502 | 2 | `(status)` | Target returned an error HTTP status |
| `RemoteRoutingError` | `REMOTE_ROUTING_ERROR` | 502 | 2 | `(node, status)` | Remote node returned an error |
| `ChatRequestError` | `CHAT_REQUEST_ERROR` | 502 | 2 | `(status, detail)` | Chat request failed |

## Schedule Errors

| Error Class | Code | HTTP | Exit | Constructor | Message |
|-------------|------|------|------|-------------|---------|
| `ScheduleNotFoundError` | `SCHEDULE_NOT_FOUND` | 404 | 1 | `(id)` | Schedule not found |
| `DuplicateScheduleError` | `DUPLICATE_SCHEDULE` | 409 | 1 | `(id)` | Schedule already exists |
| `InvalidIntervalError` | `INVALID_INTERVAL` | 400 | 1 | `(interval)` | Invalid interval format or out of range |
| `ScheduleLimitError` | `SCHEDULE_LIMIT` | 409 | 1 | `(max)` | Maximum schedules per bot reached |

## Plugin Errors

| Error Class | Code | HTTP | Exit | Constructor | Message |
|-------------|------|------|------|-------------|---------|
| `PluginNameReservedError` | `PLUGIN_NAME_RESERVED` | 400 | 1 | `(name)` | Name conflicts with a built-in capability |
| `PluginNotFoundError` | `PLUGIN_NOT_FOUND` | 404 | 1 | `(name)` | Plugin not found |
| `PluginAlreadyExistsError` | `PLUGIN_ALREADY_EXISTS` | 409 | 1 | `(name)` | Plugin already exists |
| `PluginEnvError` | `PLUGIN_ENV_ERROR` | 400 | 1 | `(message)` | Environment variable resolution error |

## Identity Errors

| Error Class | Code | HTTP | Exit | Constructor | Message |
|-------------|------|------|------|-------------|---------|
| `IdentityNotFoundError` | `IDENTITY_NOT_FOUND` | 404 | 1 | `(name)` | Identity not found |

## Connectivity Errors

| Error Class | Code | HTTP | Exit | Constructor | Message |
|-------------|------|------|------|-------------|---------|
| `ConnectError` | `CONNECT_ERROR` | 503 | 1 | `(reason)` | Connection failed |
| `InvalidInviteError` | `INVALID_INVITE` | 400 | 1 | `(reason)` | Invalid invite code |
| `HandshakeError` | `HANDSHAKE_ERROR` | 502 | 1 | `(reason)` | Noise IK handshake failed |
| `PeerOfflineError` | `PEER_OFFLINE` | 503 | 1 | `(name)` | Peer is offline |
| `RendezvousError` | `RENDEZVOUS_ERROR` | 502 | 1 | `(reason)` | Rendezvous server error |

## Metering Errors

| Error Class | Code | HTTP | Exit | Constructor | Message |
|-------------|------|------|------|-------------|---------|
| `MeterProxyAlreadyRunningError` | `METER_PROXY_ALREADY_RUNNING` | 409 | 1 | `(pid)` | Metering proxy already running |
| `MeterProxyNotRunningError` | `METER_PROXY_NOT_RUNNING` | 409 | 1 | `()` | Metering proxy is not running |
| `MeterProxyRequiredError` | `METER_PROXY_REQUIRED` | 503 | 2 | `()` | Metering proxy required but not running |

## Configuration Errors

| Error Class | Code | HTTP | Exit | Constructor | Message |
|-------------|------|------|------|-------------|---------|
| `CorruptConfigError` | `CORRUPT_CONFIG` | 500 | 1 | `(file)` | Configuration file is corrupt |
| `InvalidToolNameError` | `INVALID_TOOL_NAME` | 400 | 1 | `(name)` | Invalid tool name |

## Error Handling Patterns

### CLI Error Handling

```ts
import { MechaError } from "@mecha/core";

try {
  await spawnBot(name, workspace);
} catch (err) {
  if (err instanceof MechaError) {
    formatter.error(err.message);
    process.exit(err.exitCode);
  }
  throw err; // Re-throw unexpected errors
}
```

### HTTP Error Handling

```ts
import { MechaError } from "@mecha/core";

app.setErrorHandler((error, _request, reply) => {
  if (error instanceof MechaError) {
    reply.status(error.statusCode).send({
      error: error.code,
      message: error.message,
    });
    return;
  }
  reply.status(500).send({ error: "INTERNAL", message: "Internal server error" });
});
```

### Error Cause Chain

All factory-created errors support the `cause` option for chaining errors:

```ts
try {
  await fetchFromUpstream();
} catch (err) {
  throw new ForwardingError(502, { cause: err });
}
```

## See Also

- [Permissions (ACL)](/features/permissions) -- ACL-specific errors
- [Scheduling](/features/scheduling) -- Schedule-specific errors
- [Configuration](/guide/configuration) -- Plugin and auth errors
