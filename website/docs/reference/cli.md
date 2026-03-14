# CLI Commands

## `mecha init`

Initialize Mecha and build the Docker image.

```bash
mecha init [--headscale]
```

| Flag | Description |
|------|-------------|
| `--headscale` | Include Headscale support in the image |

## `mecha spawn`

Spawn a bot from a config file or inline.

```bash
# From config file
mecha spawn reviewer.yaml

# Inline
mecha spawn --name greeter --system "You greet people." [--model sonnet] [--auth profile]
```

| Flag | Description |
|------|-------------|
| `--name` | Bot name (inline mode) |
| `--system` | System prompt (inline mode) |
| `--model` | Claude model (default: `sonnet`) |
| `--auth` | Auth profile name |
| `--dir` | Working directory |
| `--expose` | Expose container port to host |

## `mecha chat`

Send a prompt to a running bot.

```bash
mecha chat <name> "prompt"
```

## `mecha ls`

List all bots with status, schedule info, and costs.

```bash
mecha ls
```

## `mecha start` / `mecha stop`

Start or stop a bot container.

```bash
mecha start <name>
mecha stop <name>
```

## `mecha rm`

Remove a bot and its container.

```bash
mecha rm <name>
```

## `mecha logs`

View bot container logs.

```bash
mecha logs <name> [-f]
```

| Flag | Description |
|------|-------------|
| `-f` | Follow mode (stream new logs) |

## `mecha dashboard`

Start the fleet dashboard.

```bash
mecha dashboard [--port N]
```

Default port: `7700`.

## `mecha auth`

Manage authentication profiles.

```bash
mecha auth add <profile> <key>    # Add a profile
mecha auth list                   # List profiles
mecha auth swap <bot> <profile>   # Swap a bot's auth
```

## `mecha token`

Generate a bearer token for bot API access.

```bash
mecha token
```

## `mecha doctor`

Check that all prerequisites are met.

```bash
mecha doctor
```
