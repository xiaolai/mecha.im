---
title: Schedule Commands
description: CLI reference for mecha schedule task management commands
---

# Schedule Commands

[[toc]]

All schedule commands live under `mecha schedule`.

## `mecha schedule add`

Add a periodic schedule to a bot.

```bash
mecha schedule add <bot> --id <id> --every <interval> --prompt <prompt>
```

| Argument | Description |
|----------|-------------|
| `<bot>` | bot name |

| Option | Description | Required |
|--------|-------------|----------|
| `--id <id>` | Schedule ID (lowercase, alphanumeric, hyphens) | Yes |
| `--every <interval>` | Interval (e.g. `30s`, `5m`, `1h`) | Yes |
| `--prompt <prompt>` | Prompt to send on each run | Yes |

```bash
mecha schedule add researcher --id check-papers --every 1h --prompt "Check for new papers"
```

## `mecha schedule list`

List all schedules for a bot.

```bash
mecha schedule list <bot>
```

Alias: `mecha schedule ls`

| Argument | Description |
|----------|-------------|
| `<bot>` | bot name |

## `mecha schedule pause`

Pause a schedule (or all schedules on a bot).

```bash
mecha schedule pause <bot> [schedule-id]
```

| Argument | Description |
|----------|-------------|
| `<bot>` | bot name |
| `[schedule-id]` | Schedule ID (omit to pause all) |

## `mecha schedule resume`

Resume a paused schedule (or all schedules on a bot).

```bash
mecha schedule resume <bot> [schedule-id]
```

| Argument | Description |
|----------|-------------|
| `<bot>` | bot name |
| `[schedule-id]` | Schedule ID (omit to resume all) |

## `mecha schedule run`

Trigger a schedule to run immediately.

```bash
mecha schedule run <bot> <schedule-id>
```

| Argument | Description |
|----------|-------------|
| `<bot>` | bot name |
| `<schedule-id>` | Schedule ID to trigger |

## `mecha schedule remove`

Remove a schedule from a bot.

```bash
mecha schedule remove <bot> <schedule-id>
```

Alias: `mecha schedule rm`

| Argument | Description |
|----------|-------------|
| `<bot>` | bot name |
| `<schedule-id>` | Schedule ID to remove |

## `mecha schedule history`

View past runs for a schedule.

```bash
mecha schedule history <bot> <schedule-id> [options]
```

| Argument | Description |
|----------|-------------|
| `<bot>` | bot name |
| `<schedule-id>` | Schedule ID |

| Option | Description | Default |
|--------|-------------|---------|
| `--limit <n>` | Maximum entries to show | `20` |

```bash
mecha schedule history researcher check-papers
mecha schedule history researcher check-papers --limit 5
```

---

## See Also

- [CLI Reference](./) -- overview and global options
- [Scheduling](/features/scheduling) -- cron-like automation with `mecha schedule`
