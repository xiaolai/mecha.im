# Environment Variables

## Host (CLI)

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Default API key for bots without an auth profile |
| `MECHA_COPY_HOST_CODEX_AUTH` | Set to `1` to copy host Codex auth into containers |

## Container (Agent)

These are set automatically inside bot containers:

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Injected from auth profile or host env |
| `BOT_NAME` | The bot's name |
| `BOT_CONFIG` | JSON-serialized bot configuration |
| `MECHA_TOKEN` | Bearer token for API authentication |

## Data Directory

Mecha stores all state in `~/.mecha/`:

```
~/.mecha/
  auth/           # Auth profiles (*.json)
  bots/           # Bot state and metadata
  image/          # Docker image build context
```
