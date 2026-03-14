# Bot-to-Bot Communication

Bots can discover and talk to each other over the network using built-in MCP tools.

## MCP Tools

Each bot has three communication tools available:

### `mecha_call`

Send a prompt to another bot and get a response:

```
Use mecha_call to ask the security-bot:
"Audit the dependencies in package.json for known vulnerabilities."
```

### `mecha_list`

Discover all available bots on the network:

```
Use mecha_list to see what bots are currently running.
```

### `mecha_new_session`

Start a fresh conversation with another bot (clears previous context):

```
Use mecha_new_session with security-bot, then ask it to start a fresh audit.
```

## How Discovery Works

Bots discover each other through the Tailscale/Headscale mesh network. Each bot container joins the tailnet and is reachable by its Tailscale hostname.

For local-only setups (single machine), bots communicate through Docker networking.

## Configuration

To enable mesh communication, add Tailscale config to your bot:

```yaml
name: coordinator
system: "You coordinate work across specialist bots."
tailscale:
  auth_key_profile: ts-main
  tags:
    - "tag:mecha-bot"
```

See [Tailscale Mesh](/features/tailscale) for full setup details.

## Example: Multi-Bot Workflow

```yaml
# coordinator.yaml
name: coordinator
system: |
  You are a project coordinator. When a new PR arrives:
  1. Use mecha_call to ask code-reviewer to review the code
  2. Use mecha_call to ask security-bot to check for vulnerabilities
  3. Summarize both reviews and post a comment
webhooks:
  accept: ["pull_request.opened"]
```
