---
name: bump
description: Bump version across all monorepo packages. Use when user says "bump", "version bump", "release", or wants to increment the version number.
allowed-tools: Read, Edit, Bash(git:*), Glob, Grep
---

# Version Bump

Bump the semver version across the root `package.json` and all `packages/*/package.json` in lockstep.

## Usage

```
/bump              → prompt for bump type
/bump patch        → 0.2.0 → 0.2.1
/bump minor        → 0.2.0 → 0.3.0
/bump major        → 0.2.0 → 1.0.0
/bump 0.3.0        → set exact version
```

## Workflow

1. **Read current version** from root `package.json`
2. **Determine new version**:
   - If argument is `patch`, `minor`, or `major` — increment accordingly
   - If argument is a semver string (e.g. `0.3.0`) — use it directly
   - If no argument — show current version and ask which bump type
3. **Update all package.json files**:
   - Root `package.json`
   - Every `packages/*/package.json`
4. **Show summary**: list all files changed with old → new version
5. **Do NOT commit** — leave changes staged for the user to review

## Rules

- All packages stay in lockstep (same version)
- The `integration` package may lag behind — bump it too to match
- Never modify `pnpm-lock.yaml` directly — if the user wants to update it, tell them to run `pnpm install`
- Never modify `node_modules/`
- Only update the `"version"` field, nothing else in each file
