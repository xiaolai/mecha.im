---
title: Team Templates
description: One-command deployment of coordinated multi-bot teams with shared config and ACL
---

# Team Templates

Team templates enable one-command deployment of multiple coordinated bots with shared configuration, ACL rules, and workspace scaffolding.

## Core Concepts

### Team Definition

A YAML file describing a group of bots, their roles, ACL relationships, and workspace structure:

```yaml
name: dev-team
home: ~/.mecha/_company
workspace: /projects/acme

bots:
  developer:
    cwd: /projects/acme/src
    model: claude-sonnet-4-6
    tags: [engineering]
    expose: [query, execute]

  reviewer:
    cwd: /projects/acme
    model: claude-sonnet-4-6
    tags: [engineering, quality]
    expose: [query]

acl:
  - source: developer
    targets: [reviewer]
    capabilities: [query]

scaffold:
  /projects/acme/.claude/CLAUDE.md: |
    # ACME Project
    Next.js 15 monorepo. 100% test coverage required.
```

### Deploy

`deployTeam()` performs these steps:
1. Creates shared HOME directory (if `home` is specified)
2. Scaffolds `.claude/` directories with CLAUDE.md, rules, memory (does NOT overwrite existing files)
3. Spawns each bot with the specified configuration
4. Configures ACL rules between bots
5. Registers the team in `~/.mecha/teams.json`

### Shared HOME

When bots share `--home`, they share `$HOME/.claude/` — company-wide CLAUDE.md, rules, plugins, and hooks. Auto-memory is isolated by workspace path, so bots with different workspaces don't cross-contaminate.

## Validation

Team definitions are validated before deployment:
- All bots must have a `cwd`
- ACL sources and targets must reference defined bots (or wildcard `*`)
- Scaffold paths must be within allowed roots (workspace, home, mechaDir)
- `spawnBot` failures abort deployment (no partial teams)

## Data Model

```
~/.mecha/teams.json              # deployed team registry
```

Each entry tracks: team name, bot names, home directory, workspace, deployment timestamp.

## CLI Usage

```bash
# Deploy a team from a JSON definition
mecha team deploy /tmp/dev-team.json
# Deployed team "dev-team" with 2 bot(s) and 1 ACL rule(s)
# Scaffolded 1 file(s)

# List deployed teams
mecha team list
# Name      Bots                 Home  Workspace          Deployed At
# --------  -------------------  ----  -----------------  ------------------------
# dev-team  developer, reviewer  -     /tmp/team-project  2026-03-21T09:25:48.737Z

# Team status
mecha team status dev-team
# Field       Value
# ----------  ------------------------
# name        dev-team
# bots        developer, reviewer
# home        -
# workspace   /tmp/team-project
# deployedAt  2026-03-21T09:25:48.737Z

# Teardown (stop all bots + unregister)
mecha team teardown dev-team
# Stopped bot: developer
# Stopped bot: reviewer
# Team "dev-team" torn down (2 bot(s) stopped)

# Force teardown (kill instead of graceful stop)
mecha team teardown dev-team --force
```

## Type Reference

### `TeamDef`

Team template definition parsed from YAML or JSON.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | Yes | Team name (used as registry key) |
| `description` | `string` | No | Human-readable description |
| `version` | `number` | No | Definition schema version |
| `home` | `string` | No | Shared HOME directory path (bots share `$HOME/.claude/`) |
| `workspace` | `string` | No | Shared workspace path |
| `bots` | `Record<string, TeamBotDef>` | Yes | Bot definitions keyed by name (at least one required) |
| `acl` | `TeamAclDef[]` | No | ACL rules between bots |
| `scaffold` | `ScaffoldDef` | No | Files to scaffold (path to content mapping) |

### `TeamBotDef`

Bot definition within a team template.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `cwd` | `string` | Yes | Working directory for the bot |
| `model` | `string` | No | Model override (e.g. `"claude-sonnet-4-6"`) |
| `tags` | `string[]` | No | Tags for discovery and grouping |
| `expose` | `string[]` | No | Capabilities to expose (e.g. `["query", "execute"]`) |
| `effort` | `"low" \| "medium" \| "high"` | No | Effort level for the LLM |
| `maxBudgetUsd` | `number` | No | Maximum USD budget per session |
| `sandboxMode` | `"auto" \| "off" \| "require"` | No | Sandbox isolation mode |
| `systemPrompt` | `string` | No | System prompt override (mutually exclusive with `appendSystemPrompt`) |
| `appendSystemPrompt` | `string` | No | Appended system prompt (mutually exclusive with `systemPrompt`) |

### `TeamAclDef`

ACL rule within a team template. Capabilities are validated against the runtime `Capability` type at deploy time.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `source` | `string` | Yes | Source bot name (or `"*"` for wildcard) |
| `targets` | `string[]` | Yes | Target bot names (or `"*"` for wildcard) |
| `capabilities` | `string[]` | Yes | Capabilities to grant (e.g. `["query"]`) |

### `ScaffoldDef`

```ts
type ScaffoldDef = Record<string, string>;
```

A mapping of file paths to file contents. During deployment, each path is resolved and validated to be within the allowed roots (workspace, home, or mechaDir). Existing files are never overwritten.

### `DeployResult`

Result returned by `deployTeam()` after a successful deployment.

| Field | Type | Description |
|-------|------|-------------|
| `team` | `string` | Team name |
| `bots` | `string[]` | Names of bots that were spawned |
| `aclRules` | `number` | Number of ACL rules applied (source-target pairs, expanded from `targets` arrays) |
| `scaffolded` | `string[]` | Absolute paths of files that were scaffolded |

### `DeployedTeam`

Deployed team metadata persisted to `~/.mecha/teams.json`.

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Team name |
| `home` | `string?` | Shared HOME directory (if specified) |
| `workspace` | `string?` | Shared workspace path (if specified) |
| `bots` | `string[]` | Names of deployed bots |
| `deployedAt` | `string` | ISO 8601 timestamp of deployment |

### `DeployOpts`

Options for `deployTeam()`.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `definition` | `TeamDef` | Yes | The team definition to deploy |
| `mechaDir` | `string` | Yes | Path to the mecha directory (`~/.mecha`) |
| `spawnBot` | `(name, opts) => Promise<boolean>` | Yes | Callback to spawn a bot. Receives name and config (cwd, home, model, tags, expose, effort, maxBudgetUsd, sandboxMode, systemPrompt, appendSystemPrompt). Returns `true` on success |
| `grantAcl` | `(source, target, capabilities) => void` | Yes | Callback to grant ACL permissions between bots |

## Function Reference

### `deployTeam(opts)`

Deploy a team: validates the definition, scaffolds directories, spawns bots, configures ACL, and registers the team in `teams.json`.

| Parameter | Type | Description |
|-----------|------|-------------|
| `opts` | `DeployOpts` | Deployment options (see `DeployOpts` above) |

Returns `Promise<DeployResult>`. Throws if validation fails or any bot spawn fails (no partial deployments).

Deployment steps:
1. Validates the team definition (name required, at least one bot, all bots have `cwd`, ACL references valid bots or `*`)
2. Scaffolds files from `scaffold` (restricted to workspace, home, and mechaDir roots; skips existing files)
3. Creates shared HOME `.claude/` directory if `home` is specified
4. Spawns each bot sequentially via `spawnBot` callback
5. Expands and applies ACL rules via `grantAcl` callback
6. Registers (or updates) the team in `~/.mecha/teams.json`

### `listTeams(mechaDir)`

List all deployed teams from the registry.

| Parameter | Type | Description |
|-----------|------|-------------|
| `mechaDir` | `string` | Path to `~/.mecha` |

Returns `DeployedTeam[]`. Returns an empty array if no teams are registered.

### `unregisterTeam(mechaDir, name)`

Remove a team from the registry. Does NOT stop or remove bots -- the caller is responsible for stopping bots before or after unregistering.

| Parameter | Type | Description |
|-----------|------|-------------|
| `mechaDir` | `string` | Path to `~/.mecha` |
| `name` | `string` | Team name to remove |

Returns `boolean`. Returns `false` if the team was not found.

### `validateTeamDef(def)`

Validate a team definition and return a list of error messages. An empty array means the definition is valid.

| Parameter | Type | Description |
|-----------|------|-------------|
| `def` | `TeamDef` | Team definition to validate |

Returns `string[]`. Checks:
- `name` is a non-empty string
- At least one bot is defined
- Every bot has a `cwd`
- ACL `source` and `targets` reference defined bots or wildcard `"*"`

### `parseTeamDef(raw)`

Parse a raw JSON object into a `TeamDef`. YAML parsing is the caller's responsibility -- this function handles the structural mapping.

| Parameter | Type | Description |
|-----------|------|-------------|
| `raw` | `unknown` | Raw object (typically from `JSON.parse` or a YAML parser) |

Returns `TeamDef`. Throws if `raw` is not an object.

## Package

`@mecha/teams` — `packages/teams/src/`

| Export | Description |
|--------|-------------|
| `validateTeamDef(def)` | Validate a team definition, returns error list |
| `parseTeamDef(raw)` | Parse raw JSON/YAML into a TeamDef |
| `deployTeam(opts)` | Deploy a team: scaffold + spawn + ACL |
| `listTeams(mechaDir)` | List deployed teams |
| `unregisterTeam(mechaDir, name)` | Remove a team from the registry |

The teams package is implemented and tested (100% coverage). See [CLI reference](/reference/cli/orchestration) for `mecha team` commands.

## See Also

- [Workflow Engine](/features/workflow) — coordinate team members via workflows
- [Orchestration CLI](/reference/cli/orchestration#team) — team deployment commands
- [Permissions](/features/permissions) — ACL rules in team templates
