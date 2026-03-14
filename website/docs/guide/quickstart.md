# Quick Start

## Spawn a Bot

The fastest way to get started — spawn a bot inline:

```bash
mecha spawn --name greeter --system "You greet people warmly."
```

Or from a YAML config file:

```yaml
# greeter.yaml
name: greeter
system: |
  You greet people warmly and remember their names.
model: sonnet
max_turns: 25
```

```bash
mecha spawn greeter.yaml
```

## Chat

```bash
mecha chat greeter "Hello, I'm Alice!"
```

## Check Status

```bash
mecha ls
```

## View Logs

```bash
mecha logs greeter
mecha logs greeter -f   # follow mode
```

## Open the Dashboard

```bash
mecha dashboard
# Opens http://localhost:7700
```

Click on a bot to see its individual dashboard with chat, schedule, logs, and config views.

## Stop and Remove

```bash
mecha stop greeter
mecha start greeter    # restart a stopped bot
mecha rm greeter       # remove entirely
```

## Next Steps

- [Bot Configuration](/guide/configuration) — full config schema with scheduling, webhooks, and workspaces
- [Authentication](/guide/auth) — managing API keys with profiles
- [Scheduling](/features/scheduling) — run bots on cron
- [Webhooks](/features/webhooks) — react to GitHub events
