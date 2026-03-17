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

## `mecha query`

Send a one-shot prompt to a running bot.

```bash
mecha query <name> "prompt"
```

| Flag | Description |
|------|-------------|
| `--model <model>` | Override model (e.g. sonnet, opus, haiku) |
| `--system <prompt>` | Override system prompt |
| `--max-turns <n>` | Override max turns |
| `--resume <session>` | Resume a specific session ID |
| `--effort <level>` | Thinking effort: low, medium, high, max |
| `--budget <usd>` | Max budget in USD |
| `--attach <paths...>` | Attach file/folder contents to the prompt |

## `mecha ls`

List all bots with status, uptime, and costs.

```bash
mecha ls
mecha ls --json              # JSON output for scripting
mecha ls -q                  # Names only (for piping)
mecha ls --status running    # Filter by status
```

| Flag | Description |
|------|-------------|
| `--json` | Output as JSON array |
| `-q, --quiet` | Output only bot names |
| `--status <status>` | Filter by status (running, exited) |

## `mecha start` / `mecha stop` / `mecha restart`

Start, stop, or restart a bot container.

```bash
mecha start <name>
mecha stop <name>
mecha restart <name> [--force]
```

## `mecha rm`

Remove a bot and its container.

```bash
mecha rm <name>
mecha rm <name> --force      # Stop and remove even if running
```

| Flag | Description |
|------|-------------|
| `-f, --force` | Force remove even if bot is running |

## `mecha exec`

Run a command inside a bot's container.

```bash
mecha exec <name> ls /state          # Run a command
mecha exec <name> -- claude --version  # Check Claude CLI version
mecha exec <name> -it                  # Interactive shell (bash)
```

| Flag | Description |
|------|-------------|
| `-it, --interactive` | Attach interactive terminal (TTY + stdin) |

## `mecha logs`

View bot container logs.

```bash
mecha logs <name> [-f]
```

| Flag | Description |
|------|-------------|
| `-f` | Follow mode (stream new logs) |

## `mecha ssh-key`

Show or generate the SSH public key for a bot.

```bash
mecha ssh-key <name>
```

Keys are auto-generated on first use. Add the output to GitHub Settings → SSH Keys to enable git operations from the bot.

## `mecha daemon`

Manage the singleton fleet daemon. The daemon runs the fleet API, dashboard UI, and a reconciliation loop that auto-restarts crashed bots.

```bash
mecha daemon start                    # foreground
mecha daemon start --background       # detached
mecha daemon start --host 0.0.0.0     # bind to all interfaces
mecha daemon stop                     # graceful shutdown
mecha daemon status                   # show running state
mecha daemon status --json            # JSON output
```

| Flag | Description |
|------|-------------|
| `--port <port>` | Listen port (default: `7700`) |
| `--host <host>` | Bind address (default: `127.0.0.1`) |
| `--background` | Detach from terminal |
| `--json` | JSON output (status only) |

The daemon auto-starts when you run fleet commands like `spawn`, `ls`, `stop`, etc. You rarely need to start it manually.

## `mecha dashboard`

Alias for `mecha daemon start` (foreground mode). Opens the browser automatically.

```bash
mecha dashboard [--port N] [--host H]
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

Diagnose mecha installation or a specific bot.

```bash
mecha doctor          # Check prerequisites
mecha doctor <name>   # Diagnose a specific bot
```
