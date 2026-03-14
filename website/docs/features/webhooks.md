# Webhooks

Bots can receive and process webhooks — typically from GitHub, but any HTTP POST with a JSON payload works.

## Configuration

```yaml
name: pr-reviewer
system: "You review pull requests for bugs and security issues."
webhooks:
  accept:
    - "pull_request.opened"
    - "pull_request.synchronize"
  secret: whsec_your_secret_here
expose: 8080
```

### Fields

| Field | Description |
|-------|-------------|
| `accept` | Array of event types to process (others are ignored) |
| `secret` | Optional — enables HMAC-SHA256 signature verification |

### Expose

The `expose` field maps the bot's internal port to the host, making the webhook endpoint reachable:

```
POST http://your-host:8080/api/webhook
```

## GitHub Setup

1. In your repo, go to **Settings → Webhooks → Add webhook**
2. Set the Payload URL to your bot's webhook endpoint
3. Set Content type to `application/json`
4. Set the Secret to match your config
5. Select the events you want to trigger on

## Event Filtering

The `accept` array supports dotted event types. Common examples:

| Event | Trigger |
|-------|---------|
| `push` | Any push to the repo |
| `pull_request.opened` | New PR created |
| `pull_request.synchronize` | PR updated with new commits |
| `issues.opened` | New issue created |
| `issue_comment.created` | New comment on an issue |

## Signature Verification

When `secret` is set, the bot verifies the `X-Hub-Signature-256` header on incoming requests. Requests with invalid or missing signatures are rejected with `401`.
