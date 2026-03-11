# Webhooks

## Design: Allowlist Filter + Bot Decides

Webhooks follow a two-stage model:
1. **Filter** — config-defined allowlist drops irrelevant events (no API cost)
2. **Forward** — matched events go to the bot as a prompt with full payload

## Configuration

```yaml
webhooks:
  accept:
    - "pull_request.opened"
    - "pull_request.synchronize"
    - "issue_comment.created"
```

## Flow

```
External service (e.g. GitHub)
  → POST host:8080/webhook
    → container:3000/webhook
      → check event type against allowlist
        → miss: 204 No Content (silent drop)
        → hit: forward to bot as prompt
          → bot decides what to do
          → 200 OK
```

## Event Type Format

`{resource}.{action}` matching the webhook payload:

- GitHub: `X-GitHub-Event` header + `action` field → `pull_request.opened`
- GitLab: `X-Gitlab-Event` header → mapped similarly
- Generic: `type` field in payload body

## Prompt Construction

Matched events are forwarded as:

```
You received a webhook event:

Type: pull_request.opened

Payload:
```json
{...full payload...}
```

Decide what to do.
```

The bot's system prompt guides its behavior. No template language needed.

## Exposing a Bot

```bash
mecha spawn reviewer.yaml --expose 8080
```

This maps `host:8080 → container:3000`. Point your GitHub webhook URL at `http://your-machine:8080/webhook`.

## Security

- Only explicitly exposed bots accept external traffic
- Allowlist prevents unbounded API spend
- No auth on webhook endpoint by default (GitHub uses webhook secrets — can be added later)
- Large payloads: consider a size limit (e.g., 100KB) to prevent token abuse
