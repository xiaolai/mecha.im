# Mecha Telegram Adapter

Bridge Telegram messages to mecha bots with real-time status updates.

## Setup

1. Create a bot via [@BotFather](https://t.me/BotFather) and get the token
2. Install and run:

```bash
cd adapters/telegram
npm install

# Set environment variables via .env file or shell profile
# Never pass tokens directly on the command line (shell history exposure)
export TELEGRAM_BOT_TOKEN=<your-botfather-token>
export MECHA_DASHBOARD_TOKEN=<your-dashboard-token>  # if dashboard auth is enabled

npm run start
```

## Usage

Send a message in Telegram — it goes to the default bot (orchestrator).

Use `@botname message` to route to a specific bot:

```
@posca What do you know about Claude Code?
@reviewer Check this PR for issues
@orchestrator spawn a data-analyst bot with model sonnet
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

## Verify Setup

After starting, send `/start` in Telegram. You should see:
- The adapter name and default bot
- A list of available bots (or a warning if the daemon is unreachable)

Send a test message like `Hello!` and verify you get a response from the default bot.

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TELEGRAM_BOT_TOKEN` | Yes | — | From @BotFather |
| `MECHA_DASHBOARD_TOKEN` | No | — | Dashboard bearer token for authenticated daemon access |
| `MECHA_DEFAULT_BOT` | No | `orchestrator` | Default bot for messages without @mention |
| `MECHA_URL` | No | `http://localhost:7700` | Mecha daemon URL |
| `TELEGRAM_ALLOWED_USERS` | No | (all) | Comma-separated Telegram user IDs |

## Security

Set `TELEGRAM_ALLOWED_USERS` to restrict who can use the bot:

```bash
# Find your Telegram user ID by sending /start to @userinfobot
export TELEGRAM_ALLOWED_USERS=123456789,987654321
npm run start
```

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| "Cannot reach mecha daemon" | Daemon not running or wrong URL | Start daemon with `mecha daemon start`, check `MECHA_URL` |
| "Auth failed" on bot queries | Missing or wrong dashboard token | Set `MECHA_DASHBOARD_TOKEN` to match daemon config |
| "Bot X is busy" | Bot is processing another request | Wait for current request to finish, or use a different bot |
| "⛔ Not authorized" | Your Telegram user ID not in allowlist | Add your ID to `TELEGRAM_ALLOWED_USERS` |
| No response / timeout | Bot taking too long (5min limit) | Check bot logs with `mecha logs <botname>` |
