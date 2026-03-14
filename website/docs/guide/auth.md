# Authentication

## Environment Variable

The simplest approach — set `ANTHROPIC_API_KEY`:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

All bots spawned in this shell session will use this key.

## Named Profiles

For managing multiple keys (different accounts, rate limits, budgets):

```bash
# Add a profile
mecha auth add anthropic-main sk-ant-...
mecha auth add anthropic-secondary sk-ant-...

# Add a Tailscale key
mecha auth add ts-main tskey-auth-...

# List profiles
mecha auth list
```

Profiles are stored at `~/.mecha/auth/<name>.json`.

## Using Profiles with Bots

Reference a profile in the bot config:

```yaml
name: reviewer
system: "You review code."
auth: anthropic-main
```

Or when spawning inline:

```bash
mecha spawn --name reviewer --system "You review code." --auth anthropic-main
```

## Swapping Auth at Runtime

Switch a running bot to a different profile:

```bash
mecha auth swap reviewer anthropic-secondary
```

## Bot Tokens

Generate a bearer token for direct API access to a bot:

```bash
mecha token
```

This is used internally by the fleet dashboard to authenticate with individual bot containers.
