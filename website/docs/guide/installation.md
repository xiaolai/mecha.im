# Installation

## Prerequisites

- **Node.js** 22 or later
- **Claude Code CLI** — `npm install -g @anthropic-ai/claude-code`
- **pnpm** — recommended package manager

## Install the CLI

```bash
pnpm add -g @mecha/cli
```

Or with npm:

```bash
npm install -g @mecha/cli
```

## Verify Installation

```bash
mecha --version
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Your Anthropic API key |
| `CLAUDE_CODE_OAUTH_TOKEN` | No | OAuth token for Claude Code authentication |
| `MECHA_OTP` | No | One-time password for agent creation |

## System Check

Run `mecha doctor` to verify your environment is ready:

```bash
mecha doctor
```

This checks that Node.js and the Claude Code CLI are available and sandbox support is working.

## Next Steps

Once installed, head to the [Getting Started guide](./) to create your first Mecha.
