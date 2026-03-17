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

## Query

```bash
mecha query greeter "Hello, I'm Alice!"
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

## Manage Bots

```bash
mecha stop greeter       # stop a running bot
mecha restart greeter    # restart
mecha start greeter      # start a stopped bot
mecha rm greeter         # remove entirely
mecha rm greeter -f      # force remove even if running
```

## Inspect and Debug

```bash
mecha config greeter             # view bot configuration
mecha config greeter --set model=opus  # change a setting
mecha costs                      # see spending across all bots
mecha costs greeter --period week  # per-bot cost breakdown
mecha sessions greeter           # browse conversation history
mecha exec greeter bash          # shell into the container
```

## Shell Completions

Enable tab completion for bot names and commands:

```bash
eval "$(mecha completion bash)"   # or zsh, fish
```

## Next Steps

- [Bot Configuration](/guide/configuration) — full config schema with scheduling, webhooks, and workspaces
- [Authentication](/guide/auth) — managing API keys with profiles
- [Scheduling](/features/scheduling) — run bots on cron
- [Webhooks](/features/webhooks) — react to GitHub events
- [CLI Reference](/reference/cli) — all commands and flags
