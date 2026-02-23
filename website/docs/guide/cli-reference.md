# CLI Reference

Complete reference for the `mecha` command-line interface.

## Global Options

All commands accept these flags:

| Flag | Description |
|------|-------------|
| `--json` | Output results as JSON |
| `-q, --quiet` | Suppress non-essential output |
| `-v, --verbose` | Enable verbose output |
| `--no-color` | Disable colored output |

## Commands

### `mecha doctor`

Check system requirements.

```bash
mecha doctor
```

Validates that Node.js and the Claude Code CLI are available and sandbox support is working. Exits with code 1 if any check fails.

---

### `mecha init`

Initialize the mecha environment.

```bash
mecha init
```

Creates the `~/.mecha/` directory structure for process state and logs.

---

### `mecha up`

Create and start a Mecha from a project path.

```bash
mecha up <path> [options]
```

| Argument / Option | Description |
|-------------------|-------------|
| `<path>` | **(required)** Project path for the agent's workspace |
| `-p, --port <port>` | Host port to bind |
| `--claude-token <token>` | Claude OAuth token |
| `--anthropic-key <key>` | Anthropic API key |
| `--otp <secret>` | TOTP secret for runtime access |
| `--permission-mode <mode>` | `default`, `plan`, or `full-auto` |
| `--show-token` | Print the full auth token to stdout |

**Config resolution priority:** CLI flags > environment variables > `.env` files > defaults

**Example:**

```bash
# Basic usage
mecha up ./my-project

# With explicit port and API key
mecha up ./my-project --port 7700 --anthropic-key sk-ant-...

# Full auto mode with token displayed
mecha up ./my-project --permission-mode full-auto --show-token
```

---

### `mecha ls`

List all Mecha instances.

```bash
mecha ls
```

Displays a table with columns: ID, STATE, STATUS, PATH. With `--json`, returns the full data array.

---

### `mecha start`

Start a stopped Mecha.

```bash
mecha start <id>
```

| Argument | Description |
|----------|-------------|
| `<id>` | **(required)** Mecha ID |

---

### `mecha stop`

Stop a running Mecha.

```bash
mecha stop <id>
```

| Argument | Description |
|----------|-------------|
| `<id>` | **(required)** Mecha ID |

---

### `mecha restart`

Restart a Mecha.

```bash
mecha restart <id>
```

| Argument | Description |
|----------|-------------|
| `<id>` | **(required)** Mecha ID |

---

### `mecha rm`

Remove a Mecha.

```bash
mecha rm <id> [options]
```

| Argument / Option | Description |
|-------------------|-------------|
| `<id>` | **(required)** Mecha ID |
| `--with-state` | Also remove the state data |
| `-f, --force` | Force remove even if running |

**Example:**

```bash
# Remove a stopped mecha
mecha rm abc123

# Force remove a running mecha and its state
mecha rm abc123 --force --with-state
```

---

### `mecha status`

Show status of a Mecha.

```bash
mecha status <id> [options]
```

| Argument / Option | Description |
|-------------------|-------------|
| `<id>` | **(required)** Mecha ID |
| `-w, --watch` | Watch for status changes (polls with exponential backoff) |

Displays ID, name, state, running status, start time, and project path. In watch mode, polls every 2–10 seconds until interrupted with `Ctrl+C`.

---

### `mecha logs`

Show logs for a Mecha.

```bash
mecha logs <id> [options]
```

| Argument / Option | Description |
|-------------------|-------------|
| `<id>` | **(required)** Mecha ID |
| `-f, --follow` | Follow log output (live streaming) |
| `-n, --tail <lines>` | Number of lines to show (default: `100`) |

**Example:**

```bash
# Last 50 lines
mecha logs abc123 --tail 50

# Stream logs live
mecha logs abc123 --follow
```

---

### `mecha ui`

Print the web UI URL for a Mecha.

```bash
mecha ui <id>
```

| Argument | Description |
|----------|-------------|
| `<id>` | **(required)** Mecha ID |

---

### `mecha mcp`

Print the MCP endpoint URL and token for a Mecha.

```bash
mecha mcp <id>
```

| Argument | Description |
|----------|-------------|
| `<id>` | **(required)** Mecha ID |

Returns the MCP endpoint URL for connecting external tools to this Mecha.

---

### `mecha configure`

Update runtime configuration of a Mecha.

```bash
mecha configure <id> [options]
```

| Argument / Option | Description |
|-------------------|-------------|
| `<id>` | **(required)** Mecha ID |
| `--claude-token <token>` | Claude OAuth token |
| `--anthropic-key <key>` | Anthropic API key |
| `--otp <secret>` | TOTP secret |
| `--permission-mode <mode>` | `default`, `plan`, or `full-auto` |

Accepts partial updates — pass only the options you want to change.

**Example:**

```bash
# Switch to full-auto mode
mecha configure abc123 --permission-mode full-auto

# Rotate the API key
mecha configure abc123 --anthropic-key sk-ant-new-key...
```

---

### `mecha token`

Retrieve the auth token for a running Mecha.

```bash
mecha token <id>
```

| Argument | Description |
|----------|-------------|
| `<id>` | **(required)** Mecha ID |

Prints the token directly to stdout (useful for piping).

---

### `mecha env`

Show environment variables for a Mecha.

```bash
mecha env <id> [options]
```

| Argument / Option | Description |
|-------------------|-------------|
| `<id>` | **(required)** Mecha ID |
| `--show-secrets` | Show sensitive values instead of masking them |

By default, sensitive keys (tokens, API keys, passwords) are masked with `****`.

**Example:**

```bash
# Masked output
mecha env abc123

# Show actual values
mecha env abc123 --show-secrets
```

---

### `mecha prune`

Remove all stopped Mecha instances.

```bash
mecha prune [options]
```

| Option | Description |
|--------|-------------|
| `-f, --force` | Skip confirmation prompt |

Removes instances in exited or dead states.

**Example:**

```bash
# Interactive confirmation
mecha prune

# Skip confirmation
mecha prune --force
```

---

### `mecha chat`

Send a chat message to a running Mecha.

```bash
mecha chat <id> <message>
```

| Argument | Description |
|----------|-------------|
| `<id>` | **(required)** Mecha ID |
| `<message>` | **(required)** Message text to send |

Sends the message and streams the response via SSE to stdout.

**Example:**

```bash
mecha chat abc123 "What files are in the workspace?"
```

---

### `mecha dashboard`

Launch the Mecha web dashboard.

```bash
mecha dashboard [options]
```

| Option | Description |
|--------|-------------|
| `-p, --port <port>` | Port to run on (default: `3000`) |
| `--no-open` | Do not auto-open browser |

Auto-builds the dashboard on first run if not already built.

**Example:**

```bash
# Default port
mecha dashboard

# Custom port, no browser
mecha dashboard --port 8080 --no-open
```

---

### `mecha completions`

Generate shell completion scripts.

```bash
mecha completions <shell>
```

| Argument | Description |
|----------|-------------|
| `<shell>` | **(required)** `bash`, `zsh`, or `fish` |

**Example:**

```bash
# Add to your shell profile
mecha completions zsh >> ~/.zshrc
mecha completions bash >> ~/.bashrc
mecha completions fish > ~/.config/fish/completions/mecha.fish
```
