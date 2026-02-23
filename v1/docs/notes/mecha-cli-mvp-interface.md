# Mecha CLI MVP Interface (Implementation Note)

## 0. Process Decision (Current)

Current instruction from Xiaolai:

1. Discussion-first mode.
2. Note updates only.
3. No code implementation at this stage.

## 1. Scope Lock

This note records the implementation direction after discussion:

1. Robot-personhood enhancements are documented as future work only.
2. Current implementation scope is strictly the MVP CLI interface.
3. No personhood/memory-social agency commands are included in MVP.

## 2. Deferred Future Enhancements (Not in MVP)

If Mechas are later treated as robot teammates with persistent persona, enhance:

1. Identity continuity (stable persona profile and boundaries).
2. Human-like memory layers (episodic/semantic/social + consolidation).
3. Agency and commitments (long-lived goals and promise tracking).
4. Social presence (availability/focus/etiquette states).
5. Trust and accountability (capability contract + action ledger).

These are intentionally deferred and excluded from MVP command design.

## 3. MVP CLI Commands To Implement

```bash
mecha init
mecha up <absolute_project_path> [--name <alias>] [--profile <default|strict>] [--id <id>]
mecha ls [--json]
mecha status <id> [--json] [--watch]
mecha logs <id> [--follow] [--tail <n>] [--since <duration>] [--component <runtime|hub|ui>]
mecha exec <id> -- <command...>
mecha start <id>
mecha stop <id> [--timeout <sec>]
mecha restart <id>
mecha rm <id> [--with-state] [--force]
mecha ui <id> [--open] [--print-url]
mecha mcp <id> [--print-url] [--print-token] [--print-client-config]
mecha dashboard [--open] [--print-url]
mecha chat --channel <name> [--message <text>] [--follow]
mecha hub status
mecha hub logs [--follow]
mecha doctor [--json]
```

## 4. Global Flags

Supported across commands where applicable:

1. `--json`
2. `--quiet`
3. `--verbose`
4. `--no-color`

## 5. Behavioral Rules

1. `mecha up` derives deterministic ID from canonical path:
   - `mx-<slug>-<pathhash>`
   - Unless explicit `--id` override is passed.
2. Security defaults apply automatically:
   - non-root runtime
   - read-only root filesystem
   - writable paths limited to `/workspace`, `/var/lib/mecha`, `/tmp`
3. `mecha init` guarantees shared baseline infra:
   - `mecha-net`
   - `mecha-hub`
4. `mecha ls` and `mecha status` are primary health/heartbeat operator surfaces.
5. `mecha mcp` must provide copy-paste client connection details.

## 6. Out of Scope For This MVP CLI

1. Persona profile management commands.
2. Memory timeline/consolidation commands.
3. Goal/commitment lifecycle commands.
4. Presence/contract/reflection commands.
5. Enterprise RBAC/SSO and cross-machine cluster orchestration.
