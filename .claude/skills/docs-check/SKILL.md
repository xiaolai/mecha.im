---
name: docs-check
description: "Audit website documentation against actual CLI implementations. Finds mismatches in command signatures, options, defaults, and examples."
---

# Documentation Accuracy Check

You are auditing the website documentation against the actual codebase implementation. Your goal is to find every mismatch between what the docs say and what the code does.

## Step 1: Gather all CLI command definitions

Use the Explore agent to scan `packages/cli/src/commands/` and extract every:
- `.command()` name
- `.argument()` — positional args with names and descriptions
- `.option()` and `.requiredOption()` — flags with names, descriptions, defaults
- `.alias()` — command aliases
- Default values (from Commander defaults or code)

Also scan:
- `packages/cli/src/commands/agent-*.ts` — agent server commands
- `packages/cli/src/commands/schedule-*.ts` — schedule subcommands
- `packages/cli/src/commands/budget.ts` — budget commands
- `packages/cli/src/commands/node-*.ts` — mesh node commands
- `packages/*/src/**/*.ts` for runtime API routes (`fastify.get`, `fastify.post`)
- `packages/core/src/` for types, schemas, constants (port ranges, name limits, capabilities)

## Step 2: Gather all documentation claims

Read every file in `website/docs/`:
- `reference/cli.md` — primary CLI reference
- `reference/architecture.md` — runtime API, package structure
- `reference/environment.md` — environment variables
- `guide/configuration.md` — config schema, auth profiles, sandbox modes
- `guide/concepts.md` — bot states, name rules, directory structure
- `guide/quickstart.md` — getting started examples
- `guide/installation.md` — setup examples
- `features/*.md` — all feature docs
- `advanced/*.md` — multi-machine, troubleshooting

## Step 3: Compare systematically

For each CLI command, check:

1. **Signature match** — Do `.argument()` and `.option()` in source match the docs?
   - Positional args must be documented as positional, not as `--flag`
   - Optional args `[name]` vs required `<name>` must match
   - Option names must match exactly (e.g., `--tags` not `--tag`)

2. **Default values** — Do defaults in docs match Commander defaults or code?
   - Ports: meter=7600, agent=7660, bots=7700-7799
   - Sandbox mode: `auto`
   - Schedule history limit: 20

3. **Examples** — Does every example use correct syntax?
   - Check every code block in every doc file
   - Verify argument order matches Commander definition

4. **Completeness** — Is every command documented? Is every option listed?

5. **Cross-references** — When a command appears in multiple doc pages, are they consistent?

6. **Constants** — Name length limits, port ranges, capability lists, state machine states

7. **Environment variables** — Do doc env vars match actual `process.env` reads in code?

8. **Runtime API** — Do documented HTTP routes match Fastify route registrations?

## Step 4: Report findings

Format as:

```markdown
# Documentation Audit Report

## Summary
- Files checked: N
- Commands verified: N
- Discrepancies found: N

## Discrepancies

| # | File:Line | What docs say | What code does | Severity |
|---|-----------|---------------|----------------|----------|
| 1 | reference/cli.md:223 | `--host <host>` option | `<host>` positional arg | High |
| ... | ... | ... | ... | ... |

## Verified Accurate
- [list of things confirmed correct]

## Missing Documentation
- [commands or features not documented at all]
```

Severity levels:
- **High** — User would get an error following the docs (wrong syntax, missing required arg)
- **Medium** — Docs are misleading but command still works (wrong default shown, missing optional flag)
- **Low** — Cosmetic or minor (description wording, example could be clearer)

## Rules

- Check EVERY command, not just ones that look suspicious
- Check EVERY doc file, not just cli.md
- Compare character-by-character for command signatures
- Flag commands that exist in code but not in docs
- Flag commands documented but not in code
- Always show the exact file and line number for each finding
