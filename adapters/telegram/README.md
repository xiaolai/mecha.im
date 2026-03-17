# Mecha Telegram Adapter

Bridge Telegram messages to mecha bots with real-time status updates.

## Setup

1. Create a bot via [@BotFather](https://t.me/BotFather) and get the token
2. Install and run:

```bash
cd adapters/telegram
npm install
TELEGRAM_BOT_TOKEN=your_token npx tsx index.ts
```

## Usage

Send a message in Telegram — it goes to the default bot (orchestrator).

### Talk to a specific bot

```
@posca What do you know about Claude Code?
@reviewer Check this PR for issues
```

### Commands

- `/start` — show help and available bots
- `/bots` — list fleet bots with status
- `/status` — fleet health summary

## Features

### Real-time status updates

While the bot is thinking, you see live updates:

```
🧠 Thinking... (3s)
📖 Reading files... (5s)
⚡ Running command... (8s)
✍️ Editing code... (12s)
```

### Markdown rendering

Bot responses are converted to Telegram HTML:
- **Bold**, *italic*, `code`, ~~strikethrough~~
- Code blocks with syntax highlighting
- Links, headers, blockquotes

### @bot mentions

Prefix your message with `@botname` to route to a specific bot:

```
@orchestrator spawn a data-analyst bot with model sonnet
@posca explain the Claude Agent SDK
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TELEGRAM_BOT_TOKEN` | Yes | — | From @BotFather |
| `MECHA_DEFAULT_BOT` | No | `orchestrator` | Default bot for messages without @mention |
| `MECHA_URL` | No | `http://localhost:7700` | Mecha daemon URL |
| `TELEGRAM_ALLOWED_USERS` | No | (all) | Comma-separated Telegram user IDs |

## Security

Set `TELEGRAM_ALLOWED_USERS` to restrict who can use the bot:

```bash
# Find your Telegram user ID by sending /start to @userinfobot
TELEGRAM_ALLOWED_USERS=123456789,987654321 npx tsx index.ts
```
