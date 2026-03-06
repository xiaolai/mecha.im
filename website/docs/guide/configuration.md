---
title: Configuration
description: Configure auth profiles, bot settings, sandbox modes, and runtime options.
---

# Configuration

## Auth Profiles

Mecha supports multiple authentication profiles for different API credentials.

### Adding Profiles

```bash
# Add an API key profile
mecha auth add mykey --api-key --token sk-ant-api03-...

# Add an OAuth token profile (preferred — longer lifespan)
mecha auth add mytoken --oauth --token sk-ant-oat01-...

# Tag a profile for organization
mecha auth tag <profile-name> work
```

### Managing Profiles

```bash
# List all profiles
mecha auth ls

# Set default profile
mecha auth default <profile-name>

# Switch active profile
mecha auth switch <profile-name>

# Test connectivity
mecha auth test <profile-name>

# Renew an OAuth token
mecha auth renew <profile-name> <new-token>

# Remove a profile
mecha auth rm <profile-name>
```

### Resolution Priority

When spawning a bot, credentials are resolved in this order:

1. CLI flag (`--auth <profile>`)
2. Environment variables (`ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`)
3. Default auth profile (`mecha auth default`)

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Anthropic API key for agent inference |
| `CLAUDE_CODE_OAUTH_TOKEN` | OAuth token (preferred over API key) |
| `MECHA_DIR` | Override default `~/.mecha/` directory |

## bot Configuration

Each bot has a `config.json`:

```json
{
  "configVersion": 1,
  "port": 7700,
  "token": "random-bearer-token",
  "workspace": "/Users/you/my-project",
  "home": "/opt/bots/researcher",
  "model": "claude-sonnet-4-20250514",
  "permissionMode": "default",
  "auth": "mykey",
  "tags": ["dev", "backend"],
  "expose": ["query"],
  "sandboxMode": "auto",
  "allowNetwork": false
}
```

| Field | Type | Description |
|-------|------|-------------|
| `configVersion` | number | Schema version (currently `1`) |
| `port` | number | HTTP port for the runtime API |
| `token` | string | Random Bearer token for API auth |
| `workspace` | string | Absolute path to the workspace directory (CWD) |
| `home` | string? | Custom HOME directory. Defaults to `~/.mecha/<name>/` |
| `model` | string? | Model override for this bot |
| `permissionMode` | string? | `default`, `plan`, or `full-auto` (see below) |
| `auth` | string? | Auth profile name |
| `tags` | string[]? | Tags for organization and discovery |
| `expose` | string[]? | Capabilities exposed to the mesh |
| `sandboxMode` | string? | `auto`, `off`, or `require` |
| `allowNetwork` | boolean? | Allow outbound network access (reserved) |

### Permission Modes

| Mode | Behavior |
|------|----------|
| `default` | Agent asks for approval before executing tools (safest) |
| `plan` | Agent can read files and search, but asks approval for writes and commands |
| `full-auto` | Agent executes all tools without asking (use with sandbox enforcement) |

Update configuration with:

```bash
mecha bot configure researcher --tags research,ml
```

## Port Assignment

Mecha auto-assigns ports from the 7700-7799 range. To use a specific port:

```bash
mecha bot spawn researcher ~/papers --port 7710
```

## Sandbox Modes

Control the OS sandbox level per bot:

| Mode | Behavior |
|------|----------|
| `require` | Full sandbox enforcement — fails if sandbox unavailable |
| `auto` | Uses sandbox when available, warns if unavailable (default) |
| `off` | No OS sandbox (not recommended) |

Check sandbox status:

```bash
mecha sandbox show researcher
```

## Global Settings

Mecha stores global runtime settings in `~/.mecha/settings.json`.

### `readMechaSettings(mechaDir): MechaSettings`

Read global settings from disk. Returns an empty object `{}` if the file is missing or invalid.

```ts
import { readMechaSettings } from "@mecha/core";

const settings = readMechaSettings("/Users/you/.mecha");
console.log(settings.forceHttps); // boolean | undefined
```

### `writeMechaSettings(mechaDir, settings): void`

Write global settings to disk (atomic tmp+rename). Validates the settings object before writing.

```ts
import { writeMechaSettings } from "@mecha/core";

writeMechaSettings("/Users/you/.mecha", { forceHttps: true });
```

**`MechaSettings`**

| Field | Type | Description |
|-------|------|-------------|
| `forceHttps` | `boolean?` | Force HTTPS for dashboard connections |

The schema uses `.passthrough()`, so additional fields are preserved when read and written.

## Auth Configuration

Controls which authentication methods are enabled. Stored in `~/.mecha/auth-config.json`.

### `readAuthConfig(mechaDir): AuthConfig`

Read auth config from file. Returns defaults (`{ totp: true }`) if the file is missing or malformed.

```ts
import { readAuthConfig } from "@mecha/core";

const config = readAuthConfig("/Users/you/.mecha");
console.log(config.totp); // true (default)
```

### `writeAuthConfig(mechaDir, config): void`

Write auth config to file. Throws `MechaError` if TOTP is disabled (TOTP is currently required).

```ts
import { writeAuthConfig } from "@mecha/core";

writeAuthConfig("/Users/you/.mecha", { totp: true });
```

### `resolveAuthConfig(mechaDir, overrides?): AuthConfig`

Merge file-based config with CLI flag overrides. Throws `MechaError` if the resolved config disables TOTP.

```ts
import { resolveAuthConfig } from "@mecha/core";

// Uses file defaults, override specific fields from CLI flags
const config = resolveAuthConfig("/Users/you/.mecha", { totp: true });
```

**`AuthConfig`**

| Field | Type | Description |
|-------|------|-------------|
| `totp` | `boolean` | Whether TOTP authentication is enabled (must be `true`) |

**`AuthConfigOverrides`**

| Field | Type | Description |
|-------|------|-------------|
| `totp` | `boolean?` | Override the TOTP setting from the config file |

## Plugin Registry

Mecha supports MCP plugins that extend bot capabilities. Plugins are registered globally in `~/.mecha/plugins.json` and can be attached to individual bots.

### Plugin Types

#### `PluginName`

```ts
type PluginName = string & { __brand: "PluginName" };
```

A branded string type for validated plugin names. Create one with `pluginName()`.

#### `pluginName(input): PluginName`

Validate and brand a string as a `PluginName`. Throws `InvalidNameError` if the name is not valid (lowercase alphanumeric with hyphens), or `PluginNameReservedError` if the name conflicts with a built-in capability or internal name.

```ts
import { pluginName } from "@mecha/core";

const name = pluginName("my-tool");  // PluginName
pluginName("query");                 // throws PluginNameReservedError
pluginName("INVALID");               // throws InvalidNameError
```

Reserved names include all [ACL capabilities](/features/permissions#capabilities), `"mecha"`, `"mecha-workspace"`, and object prototype keys.

#### `PluginConfigBase`

```ts
interface PluginConfigBase {
  description?: string;
  addedAt: string; // ISO timestamp
}
```

Common fields shared by all plugin types.

#### `StdioPluginConfig`

```ts
interface StdioPluginConfig extends PluginConfigBase {
  type: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
}
```

Configuration for a stdio-based MCP plugin (spawned as a subprocess).

#### `HttpPluginConfig`

```ts
interface HttpPluginConfig extends PluginConfigBase {
  type: "http" | "sse";
  url: string;
  headers?: Record<string, string>;
}
```

Configuration for an HTTP/SSE-based MCP plugin (connected over network).

#### `PluginConfig`

```ts
type PluginConfig = StdioPluginConfig | HttpPluginConfig;
```

Discriminated union of all plugin configuration types. Discriminant field: `type`.

#### `PluginRegistry`

```ts
interface PluginRegistry {
  version: 1;
  plugins: Record<string, PluginConfig>;
}
```

The on-disk schema for `plugins.json`.

### Registry Functions

#### `readPluginRegistry(mechaDir): PluginRegistry`

Read the plugin registry from disk. Returns an empty registry if the file does not exist. Throws `CorruptConfigError` if the file exists but is malformed.

#### `writePluginRegistry(mechaDir, registry): void`

Write the plugin registry to disk (atomic tmp+rename).

#### `addPlugin(mechaDir, name, config, force?): void`

Add a plugin to the registry. Throws `PluginAlreadyExistsError` unless `force` is `true`.

```ts
import { addPlugin, pluginName } from "@mecha/core";

addPlugin("/Users/you/.mecha", pluginName("my-tool"), {
  type: "stdio",
  command: "npx",
  args: ["-y", "my-mcp-tool"],
  addedAt: new Date().toISOString(),
});
```

#### `removePlugin(mechaDir, name): boolean`

Remove a plugin by name. Returns `false` if not found.

#### `getPlugin(mechaDir, name): PluginConfig | undefined`

Get a single plugin's configuration by name.

#### `listPlugins(mechaDir): Array<{ name: string; config: PluginConfig }>`

List all registered plugins with their configurations.

#### `isPluginName(mechaDir, name): boolean`

Check if a name is a registered plugin (not a capability or reserved name).

### Plugin Error Classes

| Error | Code | HTTP | Description |
|-------|------|------|-------------|
| `PluginNameReservedError` | `PLUGIN_NAME_RESERVED` | 400 | Name conflicts with a built-in capability or internal name |
| `PluginNotFoundError` | `PLUGIN_NOT_FOUND` | 404 | No plugin with this name exists |
| `PluginAlreadyExistsError` | `PLUGIN_ALREADY_EXISTS` | 409 | Plugin already registered (use `--force` to overwrite) |
| `PluginEnvError` | `PLUGIN_ENV_ERROR` | 400 | Environment variable resolution error |

See [Error Reference](/reference/errors) for the complete error catalog.
