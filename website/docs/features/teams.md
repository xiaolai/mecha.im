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

## Package

`@mecha/teams` — `packages/teams/src/`

| Export | Description |
|--------|-------------|
| `validateTeamDef(def)` | Validate a team definition, returns error list |
| `parseTeamDef(raw)` | Parse raw JSON/YAML into a TeamDef |
| `deployTeam(opts)` | Deploy a team: scaffold + spawn + ACL |
| `listTeams(mechaDir)` | List deployed teams |
| `unregisterTeam(mechaDir, name)` | Remove a team from the registry |

The teams package is implemented and tested (100% coverage). CLI commands (`mecha team deploy/list/teardown`) are planned for a future phase.
