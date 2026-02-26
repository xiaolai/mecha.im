---
description: Enforces documentation updates when CLI commands, API routes, or config schemas change
globs: "packages/*/src/**/*.ts"
---

# Documentation Sync Rule

When modifying any of these, you MUST update the corresponding website documentation:

## What triggers a doc update

| Change | Doc files to update |
|--------|---------------------|
| CLI command signature (arguments, options, flags) | `website/docs/reference/cli.md` |
| New CLI command added | `website/docs/reference/cli.md` + relevant feature/guide page |
| CLI command removed or renamed | `website/docs/reference/cli.md` + all pages referencing it |
| Runtime API route added/changed | `website/docs/reference/architecture.md` (Runtime API table) |
| Environment variable added/changed | `website/docs/reference/environment.md` |
| Config schema changed (`config.json` fields) | `website/docs/guide/configuration.md` |
| ACL capabilities added/changed | `website/docs/features/permissions.md` |
| Sandbox modes changed | `website/docs/features/sandbox.md` + `website/docs/guide/configuration.md` |
| Meter/budget behavior changed | `website/docs/features/metering.md` |
| Mesh networking changes | `website/docs/features/mesh-networking.md` + `website/docs/advanced/multi-machine.md` |
| Scheduling changes | `website/docs/features/scheduling.md` |

## How to verify

After making code changes, check:

1. Does the command signature in docs match the `.argument()` and `.option()` calls in source?
2. Are positional args documented as positional (not as `--flag`)?
3. Are default values accurate?
4. Do examples in docs use the correct syntax?

## Common mistakes to avoid

- Documenting positional arguments as `--option` flags (e.g., `node add <host>` not `--host`)
- Forgetting `<casa>` argument on schedule subcommands
- Using `--casa <name>` when the CLI uses positional `[name]`
- Showing wrong default ports (meter: 7600, agent: 7660, CASAs: 7700-7799)
- Using `strict` instead of `require` for sandbox mode
- Showing capabilities that don't exist in the ACL engine
